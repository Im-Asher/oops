import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxy from "./proxy";

function req(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost${path}`, { headers });
}

const withSession = "oops_session=valid-value";

describe("proxy 路由保护", () => {
  it("未登录访问受保护页面：307 到 /login", () => {
    const res = proxy(req("/home"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("未登录访问画布页：307 到 /login；已登录放行", () => {
    expect(proxy(req("/canvas")).headers.get("location")).toBe("http://localhost/login");
    expect(proxy(req("/canvas", withSession)).status).toBe(200);
  });

  it("根路径：已登录去 /home，未登录去 /login", () => {
    expect(proxy(req("/", withSession)).headers.get("location")).toBe("http://localhost/home");
    expect(proxy(req("/")).headers.get("location")).toBe("http://localhost/login");
  });

  it("已登录访问登录/注册页：跳首页；未登录放行", () => {
    expect(proxy(req("/login", withSession)).headers.get("location")).toBe("http://localhost/home");
    expect(proxy(req("/register", withSession)).headers.get("location")).toBe("http://localhost/home");
    expect(proxy(req("/login")).status).toBe(200);
    expect(proxy(req("/register")).status).toBe(200);
  });

  it("未认证调用受保护 API：401", () => {
    expect(proxy(req("/api/sessions")).status).toBe(401);
    expect(proxy(req("/files/asset-1.png")).status).toBe(401);
    expect(proxy(req("/upload")).status).toBe(401);
  });

  it("已认证调用受保护 API：放行", () => {
    expect(proxy(req("/api/sessions", withSession)).status).toBe(200);
    expect(proxy(req("/files/asset-1.png", withSession)).status).toBe(200);
  });

  it("认证接口公开可访问", () => {
    expect(proxy(req("/api/auth/login")).status).toBe(200);
    expect(proxy(req("/api/auth/register")).status).toBe(200);
  });

  it("静态资源放行（含未登录）", () => {
    expect(proxy(req("/_next/static/chunk.js")).status).toBe(200);
    expect(proxy(req("/logo.svg")).status).toBe(200);
  });
});
