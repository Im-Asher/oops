import { requireAdmin } from "@oops/auth";
import { notificationsService } from "@oops/domain/notifications/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/messages/:id：消息详情（主体 + 投递统计 + 已读用户明细）。
 * 已撤回消息同样可查——撤回只影响用户侧可见性，统计要保留（D4）。
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(_req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { id } = await ctx.params;
  const detail = await notificationsService.getAdminDetail(id);
  if (!detail) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "消息不存在" } },
      { status: 404 },
    );
  }
  const { notification, readBy } = detail;
  return Response.json({
    notification: { ...notification, createdAt: notification.createdAt.toISOString(), revokedAt: notification.revokedAt?.toISOString() ?? null },
    readBy: readBy.map((r) => ({ ...r, readAt: r.readAt.toISOString() })),
  });
}
