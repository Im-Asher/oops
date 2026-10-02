import { requireUser } from "@/server/auth/require-user";
import { loadSessionMessages } from "@/server/agent/transcript";
import { createSessionRepo } from "@/server/db/session.repo";
import { createAssetRepo } from "@/server/db/asset.repo";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

export const dynamic = "force-dynamic";

/** 返回会话历史消息（已重建为可直接渲染的 UIMessage 结构）。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const { id } = await params;
  const session = await createSessionRepo().get(id, userId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }
  const messages = await loadSessionMessages(id);
  return Response.json({ messages });
}

/**
 * 删除会话及其全部资产（GC）：
 * 先删对象存储字节（任一失败即中止，会话保持存在可重试）→ 删资产行 → 删会话行
 * （messages 随外键级联删除，tasks 置空外键保留审计）。
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const { id } = await params;
  const sessions = createSessionRepo();
  const session = await sessions.get(id, userId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }

  const assets = createAssetRepo();
  const storage = createStorage(defaultS3Client);
  try {
    const keys = await assets.listKeysBySession(id);
    for (const key of keys) {
      await storage.removeObject(key);
    }
  } catch {
    return Response.json(
      { error: { code: "ASSET_CLEANUP_FAILED", message: "会话资产清理失败，请稍后重试" } },
      { status: 500 },
    );
  }
  await assets.removeBySession(id);
  await sessions.remove(id);
  return Response.json({ ok: true });
}
