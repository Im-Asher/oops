import { extFromMime, generateAssetKey, type Storage } from "./s3";
import type { AssetRepo } from "@/server/db/asset.repo";

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
  });

  return Response.json(
    { url: `/files/${key}`, assetId: asset.id },
    { status: 201 },
  );
}
