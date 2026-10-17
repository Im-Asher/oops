import { describe, expect, it } from "vitest";
import proxy, { hasSessionCookie } from "./proxy";
import { NextRequest } from "next/server";

const ADMIN_COOKIE = "oops_admin_session";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3001${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("hasSessionCookie（存在性纯函数）", () => {
  it("无头/空值/仅其他键 → false", () => {
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("other=1")).toBe(false);
  });

  it("散装 cookie 中的非空管理端会话 → true", () => {
    expect(hasSessionCookie(`other=1; ${ADMIN_COOKIE}=abc; extra=2`)).toBe(true);
    // 仅「键存在值空」不算存在（proxy 引导语义与全量校验保持一致：无值等同无会话）
    expect(hasSessionCookie(`${ADMIN_COOKIE}=`)).toBe(false);
  });

  it("仅携带 web 端会话 cookie → false（两会话互不相认）", () => {
    expect(hasSessionCookie("other=1; oops_session=abc")).toBe(false);
  });
});

describe("proxy 路由矩阵", () => {
  it("页面无 cookie → 30x redirect /login", () => {
    const res = proxy(request("/users"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("仅携带 web 端会话 cookie 同样被引导登录", () => {
    const res = proxy(request("/users", "oops_session=anything"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("/login 自身放行（防重定向循环）", () => {
    expect(proxy(request("/login")).status).toBe(200);
  });

  it("/api/* 无 cookie 放行（401 语义归 handler，登录接口本身公开）", () => {
    expect(proxy(request("/api/logout", undefined)).status).toBe(200);
    expect(proxy(request("/api/login", undefined)).status).toBe(200);
  });

  it("静态资源（带扩展名）放行", () => {
    expect(proxy(request("/logo.svg")).status).toBe(200);
  });

  it("页面有管理端会话 cookie → 放行（全量校验在 layout）", () => {
    expect(proxy(request("/", `${ADMIN_COOKIE}=anything`)).status).toBe(200);
  });
});
