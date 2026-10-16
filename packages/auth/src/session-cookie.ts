import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "./session-constants";

// 常量本体在 session-constants.ts（Edge-safe）；此处 re-export 维持既有导入面
export {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
};

export interface SessionPayload {
  userId: string;
  /** Unix 秒 */
  exp: number;
  /** 会话版本（改密踢下线水位）；旧载荷缺省，解析时视为 0 以兼容存量 cookie */
  tv?: number;
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
  if (payload.tv !== undefined && typeof payload.tv !== "number") {
    return undefined;
  }
  if (payload.exp <= nowMs / 1000) return undefined;
  return { ...payload, tv: payload.tv ?? 0 };
}

/**
 * 从 Cookie 头提取会话值；保持纯函数以便脱离 next/headers 单测。
 * cookieName 参数化供管理端会话复用（默认 web 端，存量调用零改动）。
 */
export function readSessionCookie(
  cookieHeader: string,
  cookieName: string = SESSION_COOKIE_NAME,
): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return rest.join("=");
  }
  return undefined;
}

/** Set-Cookie 属性串（与 design D1 一致）；登出用 Max-Age=0 版本。 */
export function sessionCookieAttributes(maxAge: number, path = "/"): string {
  return `HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`;
}

/** 登录/注册/改密成功时追加到响应的完整 Set-Cookie 头。 */
export function sessionCookieHeader(
  userId: string,
  secret: string,
  tokenVersion = 0,
): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  return `${SESSION_COOKIE_NAME}=${createSessionCookieValue({ userId, exp, tv: tokenVersion }, secret)}; ${sessionCookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

/** 登出时的 Set-Cookie 头（立即过期）。 */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${sessionCookieAttributes(0)}`;
}

/**
 * 管理端会话三件套（design D2/D3）：独立 cookie 名 + 调用方给的独立密钥 +
 * 显式有效期（默认短于 web 端，不滑动）。载荷结构与 web 端一致（userId/exp/tv），
 * tv 仍为改密水位；status 与 role 由守卫每请求查库判定，不进载荷。
 */
export function adminSessionCookieHeader(
  userId: string,
  secret: string,
  tokenVersion: number,
  maxAge: number,
  path = "/",
): string {
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const value = createSessionCookieValue({ userId, exp, tv: tokenVersion }, secret);
  return `${ADMIN_SESSION_COOKIE_NAME}=${value}; ${sessionCookieAttributes(maxAge, path)}`;
}

/** 管理端登出的 Set-Cookie 头（立即过期），路径须与签发时一致才能覆盖。 */
export function clearAdminSessionCookieHeader(path = "/"): string {
  return `${ADMIN_SESSION_COOKIE_NAME}=; ${sessionCookieAttributes(0, path)}`;
}

/** 从 Cookie 头提取管理端会话值（只认管理端 cookie 名）。 */
export function readAdminSessionCookie(cookieHeader: string): string | undefined {
  return readSessionCookie(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
}
