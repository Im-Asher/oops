import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE_NAME } from "@oops/auth/session-constants";

// proxy 跑 Edge 运行时：不能 import @oops/auth 根入口（session-cookie 依赖 node:crypto），
// 故从零依赖常量模块深导入（M2 task 2.1 收敛，替代本地复制）。
// 这里只做存在性引导；全量校验（验签/有效期/用户状态/role）收敛在
// src/app/(console)/layout.tsx 的 requireAdminFromCookieHeader（design D2）。
// 判定的 cookie 名是管理端专用名：web 端会话 cookie 不算持有会话（add-admin-login）。

/** 存在性判定（纯函数便于单测）：头中有管理端会话 cookie 且值非空。 */
export function hasSessionCookie(
  cookieHeader: string | null | undefined,
  cookieName: string = ADMIN_SESSION_COOKIE_NAME,
): boolean {
  return Boolean(
    cookieHeader
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1),
  );
}

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // 登录入口自身公开（防重定向循环）；静态资源放行
  if (pathname === "/login" || /\.[\w-]+$/.test(pathname)) {
    return NextResponse.next();
  }
  // API 路由不做页面引导——401 语义由各 handler 的守卫负责（/api/login 本身即公开入口）
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(req.headers.get("cookie"))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  // 构建产物公开，不进 proxy
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
