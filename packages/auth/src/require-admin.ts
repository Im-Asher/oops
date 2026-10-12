import { requireUserRowFromCookieHeader } from "./require-user";

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
 * 管理守卫核心：cookie 头直入（RSC layout 无 Request 对象，admin-scaffold design D2）。
 * requireUserRowFromCookieHeader 单次查询完成验签/有效期/status/会话版本校验并带出 User 行，
 * role 判定直接用该行——守卫全程恰好一次查库（M2 task 2.1 收敛，替代旧两查）；
 * ghost 用户（会话指向已删除用户）在 requireUser 层即拒（401），不进 role 判定。
 */
export async function requireAdminFromCookieHeader(
  cookieHeader: string | null,
): Promise<AdminGuardResult> {
  const user = await requireUserRowFromCookieHeader(cookieHeader);
  if (!user) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    };
  }
  if (user.role !== "admin") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    };
  }
  return { ok: true, userId: user.id };
}

/**
 * 管理守卫原语（user-auth spec「管理员角色与管理守卫」）：
 * 未认证 401；已认证非 admin 403；admin 放行。委托 requireAdminFromCookieHeader。
 */
export async function requireAdmin(req: Request): Promise<AdminGuardResult> {
  return requireAdminFromCookieHeader(req.headers.get("cookie"));
}
