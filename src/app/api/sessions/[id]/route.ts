import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { agentRegistry } from "@/server/agent";
import { loadSessionMessages } from "@/server/agent/transcript";
import { createSessionRepo } from "@/server/db/session.repo";
import { createAssetRepo } from "@/server/db/asset.repo";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    agentId: z.string().min(1).optional(),
  })
  .refine((v) => v.title !== undefined || v.agentId !== undefined, {
    message: "至少提供 title 或 agentId 之一",
  });

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

/** 更新会话：重命名（title）与/或重绑 Agent（agentId，下一轮生效）。 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "请求体需为 JSON" } }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: parsed.error.message } }, { status: 400 });
  }
  if (parsed.data.agentId && !agentRegistry.get(parsed.data.agentId)) {
    return Response.json(
      { error: { code: "INVALID_AGENT", message: "Agent 不存在" } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const sessions = createSessionRepo();
  const session = await sessions.get(id, userId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }

  const { title, agentId } = parsed.data;
  const updated = agentId ? await sessions.updateAgent(id, agentId) : session;
  const renamed = title ? await sessions.rename(id, title) : updated;
  const result = renamed ?? updated ?? session;
  return Response.json({ id: result.id, agentId: result.agentId, title: result.title });
}
