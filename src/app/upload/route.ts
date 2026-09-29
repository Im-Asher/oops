import { handleDerivedUpload, handleUpload } from "@/server/infra/storage/upload";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";
import { createAssetRepo } from "@/server/db/asset.repo";
import { createMessageRepo } from "@/server/db/message.repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: { code: "BAD_FORM", message: "请求体须为 multipart/form-data" } },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: { code: "NO_FILE", message: "缺少 file 字段" } },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type;
  const name = file.name;

  // 画布导出：携带 sessionId 时走派生链路（另存新 asset 并追加会话消息）。
  // sourceAssetId 可选：缺失时仍导出并写入聊天，仅丢失血缘明细。
  const sessionId = form.get("sessionId");
  if (typeof sessionId === "string" && sessionId) {
    const sourceAssetId =
      typeof form.get("sourceAssetId") === "string" ? (form.get("sourceAssetId") as string) : "";
    let edits: unknown;
    const editsRaw = form.get("edits");
    if (typeof editsRaw === "string" && editsRaw.length > 0) {
      try {
        edits = JSON.parse(editsRaw);
      } catch {
        // 编辑摘要解析失败不阻断导出，仅丢失血缘明细。
      }
    }
    const width = Number(form.get("width"));
    const height = Number(form.get("height"));
    return handleDerivedUpload(
      {
        bytes,
        type,
        name,
        sessionId,
        sourceAssetId,
        edits,
        width: Number.isFinite(width) ? width : undefined,
        height: Number.isFinite(height) ? height : undefined,
      },
      {
        storage: createStorage(defaultS3Client),
        assets: createAssetRepo(),
        messages: createMessageRepo(),
      },
    );
  }

  return handleUpload(
    { bytes, type, name },
    { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
  );
}
