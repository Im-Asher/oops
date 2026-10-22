import { z } from "zod";
import { requireUser } from "@oops/auth/require-user";
import { notificationsService } from "@oops/domain/notifications/service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ read: z.literal(true) });

/**
 * 标记单条已读。仓储以「本人投递 + 未撤回 + 未读」为条件更新：
 * 不存在、属他人或已撤回一律视为不可读，回 404 不泄露该消息是否存在。
 */
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

  const { id } = await params;
  const ok = await notificationsService.markRead(userId, id);
  if (!ok) {
    return Response.json({ error: { code: "NOT_FOUND", message: "消息不存在" } }, { status: 404 });
  }
  const unreadCount = await notificationsService.unreadCount(userId);
  return Response.json({ ok: true, unreadCount });
}