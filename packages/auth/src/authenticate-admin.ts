import type { AuthSuccess } from "./authenticate";
import { authenticate } from "./authenticate";

/**
 * 管理端登录校验（复用 users 表账号）：密码正确 + `role=admin` + `status=active`。
 * 失败一律 null——登录路由据此返回与"用户名或密码不正确"完全一致的响应，
 * 不泄漏账号是否存在、也不泄漏"存在但非管理员"（spec「非管理员账号登录被拒」）。
 * 角色仍在守卫侧每请求判定：登录时刻的 role 快照不能覆盖后续被降级的情形。
 */
export function authenticateAdmin(
  username: string,
  password: string,
): Promise<AuthSuccess | null> {
  return authenticate(username, password, { requireRole: "admin" });
}
