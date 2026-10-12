import { getAuthConfig } from "@oops/config";
import { createUserRepo } from "@oops/db/user.repo";
import type { User } from "@oops/db/schema";
import {
  parseSessionCookieValue,
  readSessionCookie,
} from "./session-cookie";

/**
 * 核心认证判定（返回完整 User 行）：cookie 头 → User | null。
 * 验签 → 验有效期（parse 内含）→ 查 users 确认存在、active 且会话版本一致。
 * requireUserFromCookieHeader（只要 id）与 admin 守卫（要 role）共用此单查询实现。
 */
export async function requireUserRowFromCookieHeader(
  cookieHeader: string | null,
): Promise<User | null> {
  const raw = readSessionCookie(cookieHeader ?? "");
  const payload = parseSessionCookieValue(raw, getAuthConfig().authSecret);
  if (!payload) return null;
  const user = await createUserRepo().findById(payload.userId);
  if (!user || user.status !== "active") return null;
  if (user.tokenVersion !== payload.tv) return null;
  return user;
}

/** cookie 头 → userId | null（requireUser 与 web 端共用入口）。 */
export async function requireUserFromCookieHeader(
  cookieHeader: string | null,
): Promise<string | null> {
  return (await requireUserRowFromCookieHeader(cookieHeader))?.id ?? null;
}

/**
 * 路由层统一认证入口（design D2 的安全边界）：
 * proxy.ts 只做存在性引导，这里才是所有受保护 API 的唯一校验位置。
 * 版本不符 = 旧登录态已被踢（改密 +1 水位）。
 */
export async function requireUser(req: Request): Promise<string | null> {
  return requireUserFromCookieHeader(req.headers.get("cookie"));
}
