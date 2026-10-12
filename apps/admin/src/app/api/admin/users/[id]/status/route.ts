import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAdminAuditRepo } from "@oops/db/admin-audit.repo";
import { createUserRepo } from "@oops/db/user.repo";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(["active", "disabled"]),
});

/**
 * PATCH /api/admin/users/[id]/status：启用/停用。
 * 自禁保护（spec「禁止自禁」）：操作者不得停用自己；业务变更与审计同一事务
 * （spec「写操作全量审计」一致性要求），before/after 状态结构化落审计。
 */
export async function PATCH(
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
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_BODY", message: "请求体不合法" } },
      { status: 400 },
    );
  }
  const { status } = parsed.data;

  // 自禁保护：路由层单点判定（design D5）
  if (guard.userId === id && status === "disabled") {
    return Response.json(
      { error: { code: "SELF_DISABLE_FORBIDDEN", message: "不能停用自己的账号" } },
      { status: 422 },
    );
  }

  // 事务内以 null 返回「用户不存在」——整事务回滚零副作用，审计随业务一起不落
  const updated = await db.transaction(async (tx) => {
    const before = await createUserRepo(tx).findById(id);
    if (!before) return null;
    const after = await createUserRepo(tx).setStatus(id, status);
    if (!after) return null;
    await createAdminAuditRepo(tx).record({
      adminUserId: guard.userId,
      action: "user.status_change",
      targetType: "user",
      targetId: id,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
  if (!updated) {
    return Response.json(
      { error: { code: "USER_NOT_FOUND", message: "用户不存在" } },
      { status: 404 },
    );
  }
  return Response.json({ user: updated });
}
