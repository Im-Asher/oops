import {
  handleDerivedUpload,
  handleDesignUpload,
  handleReferenceUpload,
  handleUpload,
} from "@/server/infra/storage/upload";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";
import { requireUser } from "@oops/auth/require-user";
import { createAssetRepo } from "@oops/db/asset.repo";
import { createMessageRepo } from "@oops/db/message.repo";
import { createSessionRepo } from "@oops/db/session.repo";

export const dynamic = "force-dynamic";

/**
 * 解析可选的宽高。form.get 缺省返回 null，而 Number(null) === 0——
 * 直接 Number() 会把"未提供"记成 0×0，作品集网格据此算出错误宽高比。
 */
function parseOptionalSize(form: FormData): { width?: number; height?: number } {
  const raw = (key: string): number | undefined => {
    const value = form.get(key);
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return { width: raw("width"), height: raw("height") };
}

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
  const uploadBase = { bytes, type, name, userId };

  // 参考图上传：purpose=reference → 绑定会话的图片资产（画布选中引用用），不写聊天消息。
  // 会话须存在且属于当前用户；purpose 缺省回落普通上传/画布导出链路。
  const purpose = form.get("purpose");
  // 排版设计导出：purpose=design → 无会话归属的资产（设计没有会话概念），
  // 携带宽高供作品集网格算宽高比；同样不追加聊天消息。
  if (purpose === "design") {
    return handleDesignUpload(
      { ...uploadBase, ...parseOptionalSize(form) },
      { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
    );
  }
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
      { ...uploadBase, sessionId },
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
    return handleDerivedUpload(
      {
        ...uploadBase,
        sessionId,
        sourceAssetId,
        edits,
        ...parseOptionalSize(form),
      },
      {
        storage: createStorage(defaultS3Client),
        assets: createAssetRepo(),
        messages: createMessageRepo(),
      },
    );
  }

  return handleUpload(
    uploadBase,
    { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
  );
}
