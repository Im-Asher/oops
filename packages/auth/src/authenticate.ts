import { createUserRepo } from "@oops/db/user.repo";
import { verifyPassword } from "./password";

// 未知用户时对固定哑哈希执行等价 scrypt 运算，抹平"用户名是否存在"的耗时侧信道
const DUMMY_HASH = "scrypt$" + "A".repeat(22) + "AA==$" + "A".repeat(86) + "AA==";

export interface AuthSuccess {
  userId: string;
  /** 下发 cookie 需携带的当前会话版本（否则版本不符的 cookie 立即失效） */
  tokenVersion: number;
}

/**
 * 角色门槛（管理端登录用）：要求 role 命中且账号 active。
 * 缺省不加门槛——web 端登录的既有行为 MUST NOT 变化。
 */
export interface AuthenticateOptions {
  requireRole?: "admin";
}

/** 登录验证：成功返回 userId 与会话版本；失败一律返回 null（统一文案由路由给出，不区分失败原因）。 */
export async function authenticate(
  username: string,
  password: string,
  options: AuthenticateOptions = {},
): Promise<AuthSuccess | null> {
  const user = await createUserRepo().findByUsername(username);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  if (options.requireRole === "admin") {
    // 角色与账号状态一并判定：被停用或被降级的管理员不能再登录
    if (user.role !== "admin" || user.status !== "active") return null;
  }
  return { userId: user.id, tokenVersion: user.tokenVersion };
}
