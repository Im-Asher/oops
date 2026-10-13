import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@oops/auth/session-cookie";
import { getWebAppConfig } from "@oops/config";

export const dynamic = "force-dynamic";

/**
 * 解析 Origin/Referer 头的 host 部分。
 * 返回 null = 头不存在；"invalid" = 头存在但不可解析（如沙箱 iframe 的 Origin: null）。
 */
function headerHost(
  req: Request,
  name: "origin" | "referer",
): string | null | "invalid" {
  const value = req.headers.get(name);
  if (value === null) return null;
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

/**
 * 同源校验（CSRF 防护）：浏览器发起的跨站退出会带外站 Origin/Referer。
 * - 头不存在（curl 等非浏览器客户端）：不构成浏览器 CSRF 向量，放行
 * - 头存在但不可解析：无法证明同源，拒绝（沙箱 iframe 的 Origin: null 属此类）
 * - host 与请求目标 host 不一致：跨源，拒绝
 *   （目标 host 取 Host 头，缺失时兜底 req.url 的 host——undici 构造的
 *   Request 会过滤受管头 Host，Next 运行时两者一致）
 */
function isSameOrigin(req: Request): boolean {
  let originHost = headerHost(req, "origin");
  if (originHost === null) originHost = headerHost(req, "referer");
  if (originHost === null) return true;
  if (originHost === "invalid") return false;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return originHost === host;
}

/** 退出：仅接受同源请求；303 跳回 web（目标经 WEB_APP_URL 配置解析，dev 默认 localhost:3000）。 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return Response.json(
      { error: { code: "CROSS_ORIGIN", message: "拒绝跨源请求" } },
      { status: 403 },
    );
  }
  const res = NextResponse.redirect(getWebAppConfig().webAppUrl, 303);
  // 303 See Other：POST 后强制转 GET——307 保留 POST 会被 web 侧 405 拒。
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  return res;
}
