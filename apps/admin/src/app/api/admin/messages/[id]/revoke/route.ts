import { requireAdmin } from "@oops/auth";
import { notificationsService, NotificationError } from "@oops/domain/notifications/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const revokeSchema = z.object({ note: z.string().max(200).optional() });

/**
 * POST /api/admin/messages/:id/revoke：撤回消息（用户侧随即不可见）。
 * 幂等拒绝语义：已撤回 409、不存在 404，两者都不落审计（事务整体回滚，D4）。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { id } = await ctx.params;
  // 无 body 也允许撤回：解析失败不阻断，仅丢掉 note
  const parsed = revokeSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "撤回参数不合法" } },
      { status: 422 },
    );
  }
  try {
    const result = await notificationsService.revoke({
      id,
      adminId: guard.userId,
      note: parsed.data.note,
    });
    return Response.json({ ok: true, revokedAt: result.revokedAt.toISOString() });
  } catch (err) {
    if (err instanceof NotificationError) {
      const status = err.kind === "not_found" ? 404 : 409;
      return Response.json({ error: { code: err.kind, message: err.message } }, { status });
    }
    throw err;
  }
}
