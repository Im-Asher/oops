import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "oops_session";
/** 30 天固定有效期，不滑动（design D5） */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface SessionPayload {
  userId: string;
  /** Unix 秒 */
  exp: number;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** 会话 cookie 值 = `<base64url(payload)>.<hmac>`；明文不含敏感信息，防篡改即可。 */
export function createSessionCookieValue(
  payload: SessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** 验签 + 有效期校验；任何失败一律返回 undefined，不区分原因（不泄漏给调用方/日志）。 */
export function parseSessionCookieValue(
  value: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): SessionPayload | undefined {
  if (!value) return undefined;
  const [body, sig] = value.split(".");
  if (!body || !sig) return undefined;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
  } catch {
    return undefined;
  }
  if (typeof payload.userId !== "string" || typeof payload.exp !== "number") {
    return undefined;
  }
  if (payload.exp <= nowMs / 1000) return undefined;
  return payload;
}

/** 从 Cookie 头提取会话值；保持纯函数以便脱离 next/headers 单测。 */
export function readSessionCookie(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

/** Set-Cookie 属性串（与 design D1 一致）；登出用 Max-Age=0 版本。 */
export function sessionCookieAttributes(maxAge: number): string {
  return `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/** 登录/注册成功时追加到响应的完整 Set-Cookie 头。 */
export function sessionCookieHeader(userId: string, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue({ userId, exp }, secret)}; ${sessionCookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

/** 登出时的 Set-Cookie 头（立即过期）。 */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${sessionCookieAttributes(0)}`;
}
