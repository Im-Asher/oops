import { getConfig } from "@/lib/config";
import { createUserRepo } from "@/server/db/user.repo";
import {
  parseSessionCookieValue,
  readSessionCookie,
} from "./session-cookie";

/**
 * 路由层统一认证入口（design D2 的安全边界）：
 * 验签 → 验有效期（parse 内含）→ 查 users 确认存在且 active → 返回真实 userId。
 * proxy.ts 只做存在性引导，这里才是所有受保护 API 的唯一校验位置。
 */
export async function requireUser(req: Request): Promise<string | null> {
  const raw = readSessionCookie(req.headers.get("cookie") ?? "");
  const payload = parseSessionCookieValue(raw, getConfig().AUTH_SECRET);
  if (!payload) return null;
  const user = await createUserRepo().findById(payload.userId);
  if (!user || user.status !== "active") return null;
  return user.id;
}
