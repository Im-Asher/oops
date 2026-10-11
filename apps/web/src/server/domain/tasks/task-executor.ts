import { createAssetRepo, type AssetRepo } from "@/server/db/asset.repo";
import { createTaskRepo, type TaskRepo } from "@/server/db/task.repo";
import {
  DASHSCOPE_IMAGE_MODEL,
  DASHSCOPE_IMAGE_PROVIDER,
  generateImage,
} from "@/server/infra/providers/dashscope-images";
import { renderHtml, RenderError } from "@/server/infra/render/render-html";
import { inlineFileRefs } from "@/server/infra/render/inline-files";
import { createStorage, defaultS3Client, extFromMime, generateAssetKey } from "@/server/infra/storage/s3";

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
    type: type as TaskType,
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
        sessionId: opts.sessionId,
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
  const { prompt, size, aspectRatio, referenceAssetId } = payload as {
    prompt: string;
    size: string;
    aspectRatio: string;
    /** 引用画布图片的血缘（工具侧已完成归属校验）。 */
    referenceAssetId?: string;
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
    sessionId: ctx.sessionId,
    prompt,
    model: DASHSCOPE_IMAGE_MODEL,
    meta: {
      provider: DASHSCOPE_IMAGE_PROVIDER,
      size,
      aspectRatio,
      taskId: ctx.taskId,
      ...(referenceAssetId ? { referenceAssetId } : {}),
    },
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
    ...(referenceAssetId ? { referenceAssetId } : {}),
  };
});

/**
 * 渲染异常 → TaskError：unknown 类错误的根因在底层 cause（如浏览器启动失败），
 * 截断摘要拼入 message 使任务落库可排查；timeout/invalid_html 消息自解释，不改写。
 * cause 可能含内部路径等细节，故截断且仅 unknown 类拼接，避免全量进用户可见文案。
 */
export function renderTaskError(err: unknown): TaskError {
  const detail = (v: unknown): string => {
    const s = v instanceof Error ? v.message : String(v);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  };
  if (err instanceof RenderError) {
    if (err.kind === "unknown" && err.cause !== undefined) {
      return new TaskError(`${err.message}：${detail(err.cause)}`, err.kind);
    }
    return new TaskError(err.message, err.kind);
  }
  return new TaskError(`渲染失败：${detail(err)}`, "unknown");
}

/**
 * render_html handler（html-rendering spec）：HTML 渲染 → 截图 → S3 → assets
 * 原子语义（任一步失败整体失败，不留半成品资产）；截图 base64 随 result 返回
 * 供工具回喂模型，落库时经 slimForDb 剔除。
 */
registerTaskHandler("render_html", async (payload, ctx) => {
  const { html, width, height, referenceAssetId } = payload as {
    html: string;
    width: number;
    height: number;
    referenceAssetId?: string;
  };
  let rendered: Awaited<ReturnType<typeof renderHtml>>;
  try {
    // 版式引用的商品图/底图先内联为 data URI（沙箱默认断网，相对路径不可解析）
    const html2 = await inlineFileRefs(html);
    rendered = await renderHtml({ html: html2, width, height, signal: ctx.signal });
  } catch (err) {
    // unknown 类（含非 RenderError 的管线异常）根因只在底层 cause：全量进服务端日志，
    // 摘要经 renderTaskError 拼入任务错误供落库与 Agent 解释
    if (!(err instanceof RenderError) || err.kind === "unknown") {
      console.error("[render_html] 渲染失败:", err);
    }
    throw renderTaskError(err);
  }
  const storage = createStorage(defaultS3Client);
  const assetRepo: AssetRepo = createAssetRepo();
  const key = generateAssetKey("png");
  await storage.putObject(key, rendered.png, "image/png");
  const asset = await assetRepo.create({
    storageKey: key,
    mimeType: "image/png",
    kind: "image",
    width,
    height,
    sessionId: ctx.sessionId,
    meta: {
      renderedFromHtml: true,
      taskId: ctx.taskId,
      ...(referenceAssetId ? { referenceAssetId } : {}),
    },
    userId: ctx.userId,
  });
  return {
    assetId: asset.id,
    url: `/files/${key}`,
    data: Buffer.from(rendered.png).toString("base64"),
    mimeType: "image/png",
    width,
    height,
    taskId: ctx.taskId,
    ...(referenceAssetId ? { referenceAssetId } : {}),
  };
});
