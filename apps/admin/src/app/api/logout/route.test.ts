import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

// @oops/auth 深导入 session-cookie（纯 crypto，零 db 依赖）——无需 mock db。
// WEB_APP_URL 经 getWebAppConfig 读 process.env，用例内直接置空/赋值。

const BASE = "http://localhost:3001";

afterEach(() => {
  delete process.env.WEB_APP_URL;
});

describe("POST /api/logout（退出闭环）", () => {
  it("同源请求：Set-Cookie 立即失效会话并跳回 web（默认 dev 目标）", async () => {
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: BASE },
      }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("oops_session=;");
    expect(setCookie).toMatch(/Max-Age=0/);
    // 303 See Other：POST 后强制转 GET——307 保留 POST 会被 web 侧 405 拒。
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("跳转目标来自 WEB_APP_URL 配置而非硬编码", async () => {
    process.env.WEB_APP_URL = "https://oops.example.com";
    const res = await POST(
      new Request(`${BASE}/api/logout`, {
        method: "POST",
        headers: { origin: BASE },
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://oops.example.com/");
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
