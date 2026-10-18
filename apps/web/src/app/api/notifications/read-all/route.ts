import { requireUser } from "@oops/auth/require-user";
import { notificationsService } from "@oops/domain/notifications/service";

export const dynamic = "force-dynamic";

/**
 * 全部已读：标记该用户当前可见（未撤回）的所有未读消息。
 * 消息本身保留在列表中，仅清零未读计数（spec「未读计数与已读语义」）。
 */
export async function POST(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const marked = await notificationsService.markAllRead(userId);
  return Response.json({ ok: true, marked });
}