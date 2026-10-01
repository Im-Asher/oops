import { NextResponse, type NextRequest } from "next/server";

// 与 src/server/auth/session-cookie.ts 的 SESSION_COOKIE_NAME 保持一致。
// proxy 保持零依赖（无 node:crypto / 无 DB，Edge 运行时查不了库）：
// 这里只做 cookie 存在性引导；完整校验（验签 + 有效期 + 用户状态）
// 收敛在 src/server/auth/require-user.ts，见 change user-auth design D2。
const SESSION_COOKIE_NAME = "oops_session";

function authed(req: NextRequest): boolean {
  return Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
}

function json401(): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "请先登录" } },
    { status: 401 },
  );
}

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isAuthed = authed(req);

  // 公开 API
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  // 受保护接口与资产：未认证 401（页面数据全部经 API 获取，安全性不依赖 proxy）
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/files/") ||
    pathname.startsWith("/upload")
  ) {
    return isAuthed ? NextResponse.next() : json401();
  }

  // 首页归宿：`/` 重定向（门厅即登录页，仍无独立首页，design D6）
  if (pathname === "/") {
    return NextResponse.redirect(new URL(isAuthed ? "/chat" : "/login", req.url));
  }

  // 登录/注册页公开；已登录访问则进工作台
  if (pathname === "/login" || pathname === "/register") {
    return isAuthed ? NextResponse.redirect(new URL("/chat", req.url)) : NextResponse.next();
  }

  // 静态资源放行（/files 已在上面拦下，不受此规则影响）
  if (/\.[\w-]+$/.test(pathname)) return NextResponse.next();

  // 其余页面：未认证引导去登录
  return isAuthed ? NextResponse.next() : NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // 构建产物与图标本就公开，不进 proxy
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
