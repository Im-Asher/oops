import { createUserRepo } from "@oops/db/user.repo";
import { requireUser } from "./require-user";

/** 守卫判定结果：ok=放行（带 userId）；否则携带 HTTP 状态与人话文案。 */
export type AdminGuardResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      status: 401 | 403;
      code: "UNAUTHORIZED" | "FORBIDDEN";
      message: string;
    };

/**
 * 管理守卫原语（user-auth spec「管理员角色与管理守卫」）：
 * 未认证 401；已认证非 admin 403；admin 放行。
 * 组合 requireUser（验签/有效期/status/会话版本全量校验）+ role 判定；
 * role=admin 经手工 SQL 授予（与邀请码发放同模式）。本变更不接入任何路由。
 */
export async function requireAdmin(req: Request): Promise<AdminGuardResult> {
  const userId = await requireUser(req);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    };
  }
  const user = await createUserRepo().findById(userId);
  if (user?.role !== "admin") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    };
  }
  return { ok: true, userId };
}
