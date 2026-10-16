import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

// @oops/auth 深导入 session-cookie（纯 crypto，零 db 依赖）——无需 mock db。
// 管理端会话 cookie 属性经 getAdminAuthConfig 读 process.env。

const BASE = "http://localhost:3001";

// getAdminAuthConfig 未配 ADMIN_AUTH_SECRET 时回退 AUTH_SECRET（两者都走长度校验）
process.env.AUTH_SECRET ??= "admin-test-secret-0123456789abcdef";

afterEach(() => {
  delete process.env.ADMIN_COOKIE_PATH;
});

describe("POST /api/logout（退出闭环）", () => {
  it("同源请求：管理端会话立即失效并跳登录页", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: BASE },
      }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("oops_admin_session=;");
    expect(setCookie).toMatch(/Max-Age=0/);
    // 303 See Other：POST 后强制转 GET——登录页不接受 POST
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/login`);
  });

  it("不触碰 web 端会话 cookie", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: BASE },
      }),
    );
    expect(res.headers.get("set-cookie")).not.toContain("oops_session=");
  });

  it("cookie Path 走 ADMIN_COOKIE_PATH 配置（同域子路径部署）", async () => {
    process.env.ADMIN_COOKIE_PATH = "/admin";
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: BASE },
      }),
    );
    expect(res.headers.get("set-cookie")).toMatch(/Path=\/admin/);
  });

  it("无 Origin/Referer（非浏览器客户端）放行", async () => {
    const res = await POST(new Request(`${BASE}/api/logout`, { method: "POST" }));
    expect(res.status).toBe(303);
  });

  it("Referer 兜底同源判定", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { referer: `${BASE}/audit` },
      }),
    );
    expect(res.status).toBe(303);
  });

  it("跨源 Origin：403 且不清会话 cookie（CSRF 拒绝）", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("不可解析的 Origin（沙箱 iframe Origin: null）：拒绝", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: "null" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("跨源 Referer 兜底同样拒绝", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { referer: "http://evil.example/page" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
