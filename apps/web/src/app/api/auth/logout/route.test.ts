import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("登出：200 + 立即过期的会话 cookie", async () => {
    const res = await POST(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("oops_session=;");
    expect(cookie).toContain("Max-Age=0");
  });
});
