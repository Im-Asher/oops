import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// @oops/auth 全量入口经 register.ts 顶层拉起 @oops/db index（顶层建 pg Pool）——
// 本测试只需要 clearSessionCookieHeader（纯 crypto），mock 掉 db index。
vi.mock("@oops/db", () => ({ db: {} }));

describe("POST /api/logout（退出闭环）", () => {
  it("Set-Cookie 立即失效会话并跳回 web 首页", async () => {
    const res = await POST();
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("oops_session=;");
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
