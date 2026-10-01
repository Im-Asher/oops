import { requireUser } from "@/server/auth/require-user";
import { loadSessionMessages } from "@/server/agent/transcript";
import { createSessionRepo } from "@/server/db/session.repo";

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
