import { createAssetRepo, type AssetRepo } from "@/server/db/asset.repo";
import { createTaskRepo, type TaskRepo } from "@/server/db/task.repo";
import {
  DASHSCOPE_IMAGE_MODEL,
  DASHSCOPE_IMAGE_PROVIDER,
  generateImage,
} from "@/server/infra/providers/dashscope-images";
import { createStorage, defaultS3Client, extFromMime, generateAssetKey } from "@/server/infra/storage/s3";

/** 单任务超时（毫秒）。 */
export const TASK_TIMEOUT_MS = 90_000;
/** 全局并发上限。 */
export const TASK_CONCURRENCY = 2;

export class TaskError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export interface TaskHandlerContext {
  signal: AbortSignal;
  taskId: string;
  // 任务归属用户：handler 用它落资产，防止跨用户可见
  userId: string;
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
  repo?: TaskRepo;
}

/** 提交任务并同步等待完成；失败时抛 TaskError，调用方据此回喂模型。 */
export async function submitAndWait(
  type: string,
  payload: unknown,
  opts: SubmitOptions,
): Promise<unknown> {
  const repo = opts.repo ?? createTaskRepo();
  const created = await repo.create({
    type: type as "generate_image",
    payload,
    sessionId: opts.sessionId,
    userId: opts.userId,
  });
  const taskId = created.id;
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
      });
      await repo.update(taskId, { status: "succeeded", result: slimForDb(result) });
      return result;
    } finally {
      clearTimeout(timer);
      release();
    }
  } catch (err) {
    const message =
      err instanceof TaskError ? err.message : (err as Error)?.message ?? "任务失败";
    await repo.update(taskId, { status: "failed", error: message });
    throw err;
  }
}

/** 启动时清理：把上一次进程残留的 running 任务标记为 failed（interrupted）。 */
export async function recoverInterruptedTasks(repo: TaskRepo = createTaskRepo()): Promise<number> {
  const all = await repo.list();
  const interrupted = all.filter((t) => t.status === "running");
  for (const t of interrupted) {
    await repo.update(t.id, { status: "failed", error: "interrupted-by-restart" });
  }
  return interrupted.length;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

registerTaskHandler("generate_image", async (payload, ctx) => {
  const { prompt, size, aspectRatio } = payload as {
    prompt: string;
    size: string;
    aspectRatio: string;
  };
  const gen = await generateImage({ prompt, size, aspectRatio }, ctx.signal);
  if (!gen.ok) {
    throw new TaskError(gen.error.message, gen.error.kind);
  }
  const storage = createStorage(defaultS3Client);
  const assetRepo: AssetRepo = createAssetRepo();
  const key = generateAssetKey(extFromMime(gen.mimeType));
  await storage.putObject(key, base64ToBytes(gen.data), gen.mimeType);
  const asset = await assetRepo.create({
    storageKey: key,
    mimeType: gen.mimeType,
    prompt,
    model: DASHSCOPE_IMAGE_MODEL,
    meta: { provider: DASHSCOPE_IMAGE_PROVIDER, size, aspectRatio, taskId: ctx.taskId },
    userId: ctx.userId,
  });
  return {
    assetId: asset.id,
    url: `/files/${key}`,
    data: gen.data,
    mimeType: gen.mimeType,
    prompt,
    model: DASHSCOPE_IMAGE_MODEL,
    size,
    provider: DASHSCOPE_IMAGE_PROVIDER,
    taskId: ctx.taskId,
  };
});
