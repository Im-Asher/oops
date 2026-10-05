import { extFromMime, generateAssetKey, type Storage } from "./s3";
import type { AssetRepo } from "@/server/db/asset.repo";
import type { MessageRepo } from "@/server/db/message.repo";

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadRejection =
  | { code: "UNSUPPORTED_TYPE"; message: string }
  | { code: "TOO_LARGE"; message: string };

/** 校验上传文件的 MIME 白名单与大小硬上限；返回 null 表示通过。 */
export function validateUpload(
  type: string,
  size: number,
): UploadRejection | null {
  if (!ALLOWED_IMAGE_TYPES.includes(type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { code: "UNSUPPORTED_TYPE", message: `不支持的文件类型：${type}` };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return {
      code: "TOO_LARGE",
      message: `文件过大，上限 ${MAX_UPLOAD_BYTES} 字节`,
    };
  }
  return null;
}

export interface UploadInput {
  bytes: Uint8Array;
  type: string;
  name?: string;
  userId: string;
}

export interface UploadDeps {
  storage: Storage;
  assets: AssetRepo;
}

/** 处理一次图片上传：校验 → 落库对象 → 记录 asset → 返回 url。 */
export async function handleUpload(
  input: UploadInput,
  deps: UploadDeps,
): Promise<Response> {
  const rejection = validateUpload(input.type, input.bytes.length);
  if (rejection) {
    const status = rejection.code === "UNSUPPORTED_TYPE" ? 415 : 413;
    return Response.json({ error: rejection }, { status });
  }

  const key = generateAssetKey(extFromMime(input.type));
  await deps.storage.putObject(key, input.bytes, input.type);
  const asset = await deps.assets.create({
    storageKey: key,
    mimeType: input.type,
    meta: input.name ? { originalName: input.name } : undefined,
    userId: input.userId,
  });

  return Response.json(
    { url: `/files/${key}`, assetId: asset.id },
    { status: 201 },
  );
}

export interface ReferenceUploadInput extends UploadInput {
  sessionId: string;
}

/**
 * 处理参考图上传：复用同一套 MIME/大小校验，落库绑定 sessionId 的 kind=image
 * 资产，但不追加任何聊天消息——参考图由画布承载，选中后经 /api/chat 引用注入。
 */
export async function handleReferenceUpload(
  input: ReferenceUploadInput,
  deps: UploadDeps,
): Promise<Response> {
  const rejection = validateUpload(input.type, input.bytes.length);
  if (rejection) {
    const status = rejection.code === "UNSUPPORTED_TYPE" ? 415 : 413;
    return Response.json({ error: rejection }, { status });
  }

  const key = generateAssetKey(extFromMime(input.type));
  await deps.storage.putObject(key, input.bytes, input.type);
  const asset = await deps.assets.create({
    storageKey: key,
    mimeType: input.type,
    sessionId: input.sessionId,
    kind: "image",
    meta: input.name
      ? { originalName: input.name, purpose: "reference" }
      : { purpose: "reference" },
    userId: input.userId,
  });

  return Response.json({ url: `/files/${key}`, assetId: asset.id }, { status: 201 });
}

export interface DerivedUploadInput extends UploadInput {
  sessionId: string;
  /** 源 asset 的 id，用于记录编辑血缘 */
  sourceAssetId: string;
  /** 裁剪矩形与滤镜参数摘要（已 JSON 解析） */
  edits?: unknown;
  width?: number;
  height?: number;
}

export interface DerivedUploadDeps extends UploadDeps {
  messages: MessageRepo;
}

/**
 * 处理画布导出：复用同一套 MIME/大小校验，落库一个新 asset（kind=edited，
 * meta 记录 sourceAssetId 与编辑摘要），并以 assistant 图片消息追加到会话，
 * 使聊天与画布自然联动。原图字节不被修改。
 */
export async function handleDerivedUpload(
  input: DerivedUploadInput,
  deps: DerivedUploadDeps,
): Promise<Response> {
  const rejection = validateUpload(input.type, input.bytes.length);
  if (rejection) {
    const status = rejection.code === "UNSUPPORTED_TYPE" ? 415 : 413;
    return Response.json({ error: rejection }, { status });
  }

  const key = generateAssetKey(extFromMime(input.type));
  await deps.storage.putObject(key, input.bytes, input.type);
  const asset = await deps.assets.create({
    storageKey: key,
    mimeType: input.type,
    sessionId: input.sessionId,
    kind: "edited",
    width: input.width,
    height: input.height,
    meta: { sourceAssetId: input.sourceAssetId, edits: input.edits ?? null },
    userId: input.userId,
  });

  const url = `/files/${key}`;
  await deps.messages.create({
    sessionId: input.sessionId,
    userId: input.userId,
    role: "assistant",
    content: "已导出为新图片",
    toolCalls: [{ type: "edited_image", url, assetId: asset.id, sourceAssetId: input.sourceAssetId }],
  });

  return Response.json({ url, assetId: asset.id }, { status: 201 });
}
