import { requireUser } from "@oops/auth/require-user";
import { notificationsService } from "@oops/domain/notifications/service";

export const dynamic = "force-dynamic";

/** 当前用户未读消息数（铃铛角标轮询入口，与列表分离以保持响应最小）。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const unreadCount = await notificationsService.unreadCount(userId);
  return Response.json({ unreadCount });
}