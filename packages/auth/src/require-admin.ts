import { getAdminAuthConfig } from "@oops/config";
import { createUserRepo } from "@oops/db/user.repo";
import type { User } from "@oops/db/schema";
import {
  parseSessionCookieValue,
  readAdminSessionCookie,
} from "./session-cookie";

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
 * 管理端会话校验（返回完整 User 行）：只认管理端 cookie 名与管理端密钥。
 * web 端会话 cookie 因 cookie 名不同在此读不到 → 判定未认证（spec
 * 「管理端会话与 web 端会话互不相认」）。role 每请求实时判定：登录时刻是 admin
 * 不代表此刻仍是（管理员可被降级）。
 */
export async function requireAdminRowFromCookieHeader(
  cookieHeader: string | null,
): Promise<User | null> {
  const raw = readAdminSessionCookie(cookieHeader ?? "");
  const payload = parseSessionCookieValue(
    raw,
    getAdminAuthConfig().adminAuthSecret,
  );
  if (!payload) return null;
  const user = await createUserRepo().findById(payload.userId);
  if (!user || user.status !== "active") return null;
  if (user.tokenVersion !== payload.tv) return null;
  return user;
}

/**
 * 管理守卫核心：cookie 头直入（RSC layout 无 Request 对象，admin-scaffold design D2）。
 * 单次查询完成验签/有效期/status/会话版本校验并带出 User 行，role 判定直接用该行；
 * ghost 用户（会话指向已删除用户）在此即拒（401），不进 role 判定。
 */
export async function requireAdminFromCookieHeader(
  cookieHeader: string | null,
): Promise<AdminGuardResult> {
  const user = await requireAdminRowFromCookieHeader(cookieHeader);
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
