import { describe, expect, it } from "vitest";
import proxy, { hasSessionCookie } from "./proxy";
import { NextRequest } from "next/server";

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

  it("散装 cookie 中的非空 oops_session → true", () => {
    expect(hasSessionCookie("other=1; oops_session=abc; extra=2")).toBe(true);
    // 仅「键存在值空」不算存在（proxy 引导语义与全量校验保持一致：无值等同无会话）
    expect(hasSessionCookie("oops_session=")).toBe(false);
  });
});

describe("proxy 路由矩阵", () => {
  it("页面无 cookie → 30x redirect /gate", () => {
    const res = proxy(request("/users"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("/gate");
  });

  it("/gate 自身放行（防重定向循环）", () => {
    expect(proxy(request("/gate")).status).toBe(200);
  });

  it("/api/* 无 cookie 放行（401 语义归 handler，logout 幂等）", () => {
    expect(proxy(request("/api/logout", undefined)).status).toBe(200);
  });

  it("静态资源（带扩展名）放行", () => {
    expect(proxy(request("/logo.svg")).status).toBe(200);
  });

  it("页面有 cookie → 放行（全量校验在 layout）", () => {
    expect(proxy(request("/", "oops_session=anything")).status).toBe(200);
  });
});
