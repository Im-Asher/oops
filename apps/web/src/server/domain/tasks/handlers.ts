import { createAssetRepo, type AssetRepo } from "@oops/db/asset.repo";
import { registerTaskHandler, TaskError } from "@oops/domain/tasks/executor";
import {
  DASHSCOPE_IMAGE_MODEL,
  DASHSCOPE_IMAGE_PROVIDER,
  generateImage,
} from "@/server/infra/providers/dashscope-images";
import { renderHtml, RenderError } from "@/server/infra/render/render-html";
import { inlineFileRefs } from "@/server/infra/render/inline-files";
import { createStorage, defaultS3Client, extFromMime, generateAssetKey } from "@/server/infra/storage/s3";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
