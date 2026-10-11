import { NextResponse, type NextRequest } from "next/server";

// 与 packages/auth/src/session-cookie.ts 的 SESSION_COOKIE_NAME 保持一致。
// proxy 跑 Edge 运行时：不能 import @oops/auth（session-cookie 依赖 node:crypto，
// 非 edge-safe），cookie 名常量本地复制（web proxy 同款先例，改一侧必须同步另一侧）。
// 这里只做存在性引导；全量校验（验签/有效期/用户状态/role）收敛在
// src/app/(console)/layout.tsx 的 requireAdminFromCookieHeader（design D2）。
const SESSION_COOKIE_NAME = "oops_session";

/** 存在性判定（纯函数便于单测）：头中有 oops_session 且值非空。 */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  return Boolean(
    cookieHeader
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.slice(SESSION_COOKIE_NAME.length + 1),
  );
}

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // /gate 引导页自身公开（防重定向循环）；静态资源放行
  if (pathname === "/gate" || /\.[\w-]+$/.test(pathname)) {
    return NextResponse.next();
  }
  // API 路由不做页面引导——401 语义由各 handler 的守卫负责（M2 接 requireAdmin）
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(req.headers.get("cookie"))) {
    return NextResponse.redirect(new URL("/gate", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // 构建产物公开，不进 proxy
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
