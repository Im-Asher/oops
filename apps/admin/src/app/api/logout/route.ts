import { NextResponse } from "next/server";
import { getAdminAuthConfig } from "@oops/config";
import { clearAdminSessionCookieHeader } from "@oops/auth/session-cookie";
import { isSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

/**
 * 退出：仅接受同源请求；303 跳回管理端登录页。
 * 只清管理端会话 cookie——跨域无法也不应尝试清除 web 端会话（design D7）。
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return Response.json(
      { error: { code: "CROSS_ORIGIN", message: "拒绝跨源请求" } },
      { status: 403 },
    );
  }
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  // 303 See Other：POST 后强制转 GET（登录页不接受 POST）
  res.headers.append(
    "Set-Cookie",
    clearAdminSessionCookieHeader(getAdminAuthConfig().adminCookiePath),
  );
  return res;
}
