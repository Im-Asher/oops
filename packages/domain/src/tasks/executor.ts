import { createTaskRepo, type TaskRepo } from "@oops/db/task.repo";
import { defaultCreditGate, type CreditGate } from "../credits/service";
import { TaskError } from "./task-error";

/** 单任务超时（毫秒）。 */
export const TASK_TIMEOUT_MS = 90_000;
/** 全局并发上限。 */
export const TASK_CONCURRENCY = 2;

/** 已实现 handler 的任务类型（schema 枚举的子集；export 预留）。 */
const TASK_TYPES = ["generate_image", "render_html"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** 运行时枚举守卫（工具/路由层校验用；executor 仍接受测试注入的临时类型）。 */
export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}

export { TaskError };

export interface TaskHandlerContext {
  signal: AbortSignal;
  taskId: string;
  // 任务归属用户：handler 用它落资产，防止跨用户可见
  userId: string;
  // 产生任务的会话：handler 落资产时回填 assets.sessionId，否则会话删除 GC 扫不到
  sessionId?: string;
}

export type TaskHandler = (
  payload: unknown,
  ctx: TaskHandlerContext,
) => Promise<unknown>;

const handlers = new Map<string, TaskHandler>();

export function registerTaskHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler);
}

let activeCount = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeCount < TASK_CONCURRENCY) {
    activeCount += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release(): void {
  activeCount -= 1;
  const next = waiters.shift();
  if (next && activeCount < TASK_CONCURRENCY) {
    activeCount += 1;
    next();
  }
}

/** 持久化时剔除 base64 等大字段，避免 tasks.result 膨胀。 */
function slimForDb(result: unknown): unknown {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    const { data: _data, ...rest } = result as Record<string, unknown>;
    return rest;
  }
  return result;
}

export interface SubmitOptions {
  signal?: AbortSignal;
  sessionId?: string;
  // 必传：任务与资产归属的真实用户（来自 require-user），无固定默认
  userId: string;
  // 任务态更新仓储；任务行创建由 credits.freezeForTask 在事务内完成（见下）
  repo?: TaskRepo;
  /**
   * 积分闸门：任务创建 + 冻结同事务（缺余额即失败回滚，无任务行残留）。
   * 缺省注入生产闸门（真实扣费）；单测传直通 stub 并配套 opts.repo。
   */
  credits?: CreditGate;
}

/**
 * 提交任务并同步等待完成。
 * 终态与积分严格一致：succeeded → settle 退差；failed/canceled → release 释放；
 * 进程崩溃的残余由启动 recover（标 failed）+ reconcile（释放泄漏冻结）兜底。
 * 失败时抛 TaskError，调用方据此回喂模型。
 */
export async function submitAndWait(
  type: string,
  payload: unknown,
  opts: SubmitOptions,
): Promise<unknown> {
  const repo = opts.repo ?? createTaskRepo();
  const gate = opts.credits ?? defaultCreditGate;
  // 余额不足 / 定价缺失在此抛 TaskError，任务行随事务回滚，不存在免费或悬空任务
  const { taskId } = await gate.freezeForTask({
    userId: opts.userId,
    type,
    payload,
    sessionId: opts.sessionId,
  });
  try {
    await acquire();
    await repo.update(taskId, { status: "running" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", () => controller.abort());
    try {
      const handler = handlers.get(type);
      if (!handler) {
        throw new TaskError(`未登记的任务类型：${type}`, "unknown");
      }
      const result = await handler(payload, {
        signal: controller.signal,
        taskId,
        userId: opts.userId,
        sessionId: opts.sessionId,
      });
      await repo.update(taskId, { status: "succeeded", result: slimForDb(result) });
      await gate.settle(taskId);
      return result;
    } finally {
      clearTimeout(timer);
      release();
    }
  } catch (err) {
    const message =
      err instanceof TaskError ? err.message : (err as Error)?.message ?? "任务失败";
    await repo.update(taskId, { status: "failed", error: message });
    await gate.release(taskId);
    throw err;
  }
}

/**
 * 启动时清理：单实例下任何 pending/running 残留都是上一进程的孤儿
 * （提交即进入 running，pending 只存在于毫秒级窗口），统一标记 failed；
 * 对应冻结由 reconcileFrozen 一并释放。
 */
export async function recoverInterruptedTasks(repo: TaskRepo = createTaskRepo()): Promise<number> {
  const all = await repo.list();
  const orphans = all.filter((t) => t.status === "running" || t.status === "pending");
  for (const t of orphans) {
    await repo.update(t.id, { status: "failed", error: "interrupted-by-restart" });
  }
  return orphans.length;
}
