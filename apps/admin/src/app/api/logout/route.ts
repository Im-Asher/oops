import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@oops/auth";

// POST /api/logout：清会话 cookie（Max-Age=0 立即失效）并跳回 web 首页
// （spec「退出登录」闭环）。303 See Other 强制后续转 GET——307 会保留 POST
// 方法，落到 web 根路径被 405 拒。proxy 对 /api/* 放行——清 cookie 是幂等
// 操作，未登录调用同样安全，无需守卫。
// 跳转目标写死 dev 形态：生产域名与 cookie Domain 同批进部署清单（design 风险项）。
export async function POST(): Promise<NextResponse> {
  const res = NextResponse.redirect("http://localhost:3000", 303);
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
