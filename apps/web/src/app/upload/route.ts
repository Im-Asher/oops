import { handleDerivedUpload, handleReferenceUpload, handleUpload } from "@/server/infra/storage/upload";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";
import { requireUser } from "@/server/auth/require-user";
import { createAssetRepo } from "@/server/db/asset.repo";
import { createMessageRepo } from "@/server/db/message.repo";
import { createSessionRepo } from "@/server/db/session.repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

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

  // 参考图上传：purpose=reference → 绑定会话的图片资产（画布选中引用用），不写聊天消息。
  // 会话须存在且属于当前用户；purpose 缺省回落普通上传/画布导出链路。
  const purpose = form.get("purpose");
  if (purpose === "reference") {
    const sessionId = form.get("sessionId");
    if (typeof sessionId !== "string" || !sessionId) {
      return Response.json(
        { error: { code: "NO_SESSION", message: "参考图上传需要 sessionId" } },
        { status: 400 },
      );
    }
    const session = await createSessionRepo().get(sessionId, userId);
    if (!session) {
      return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
    }
    return handleReferenceUpload(
      { bytes, type, name, sessionId, userId },
      { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
    );
  }

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
        userId,
      },
      {
        storage: createStorage(defaultS3Client),
        assets: createAssetRepo(),
        messages: createMessageRepo(),
      },
    );
  }

  return handleUpload(
    { bytes, type, name, userId },
    { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
  );
}
