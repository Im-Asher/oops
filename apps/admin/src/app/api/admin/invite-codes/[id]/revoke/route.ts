/**
 * POST /api/admin/invite-codes/[id]/revoke：作废邀请码。
 * 作废与审计同事务（invite.revoke，before/after 记 revokedAt 状态）；
 * 重复作废幂等：不重复落审计，返回 alreadyRevoked 标记与现值；不存在 404。
 */
import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import {
  createInviteCodeRepo,
  deriveInviteStatus,
  type InviteCode,
} from "@oops/db/invite-code.repo";
import { withAudit } from "@oops/db/admin-audit.repo";

/** revoke 0 行命中时中断事务：审计随业务一起不落，外层据此区分 404 / 已作废幂等。 */
class RevokeNoOpError extends Error {}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { id } = await params;
  try {
    const revoked = await withAudit<InviteCode>(
      (fn) => db.transaction(fn),
      (row) => ({
        adminUserId: guard.userId,
        action: "invite.revoke" as const,
        targetType: "invite_code" as const,
        targetId: id,
        before: { revokedAt: null },
        after: { revokedAt: row.revokedAt?.toISOString() ?? null },
      }),
      async (tx) => {
        const row = await createInviteCodeRepo(tx).revoke(id);
        if (!row) throw new RevokeNoOpError();
        return row;
      },
    );
    // 行上补派生 status，与列表接口行形状一致
    return Response.json({
      inviteCode: { ...revoked, status: deriveInviteStatus(revoked) },
      alreadyRevoked: false,
    });
  } catch (e) {
    if (!(e instanceof RevokeNoOpError)) throw e;
    const existing = await createInviteCodeRepo().findById(id);
    if (!existing) {
      return Response.json(
        { error: { code: "INVITE_CODE_NOT_FOUND", message: "邀请码不存在" } },
        { status: 404 },
      );
    }
    return Response.json({
      inviteCode: { ...existing, status: deriveInviteStatus(existing) },
      alreadyRevoked: true,
    });
  }
}
