import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rateLimited: false,
}));

vi.mock("@/server/auth/authenticate", () => ({
  authenticate: h.authenticate,
}));
vi.mock("@/server/auth/rate-limit", () => ({
  rateLimit: () => !h.rateLimited,
  clientIp: () => "test-ip",
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/login", () => {
  it("登录成功：200 + 签发会话 cookie", async () => {
    h.authenticate.mockResolvedValueOnce("u1");
    const res = await post({ username: "alice", password: "whatever" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("oops_session=");
  });

  it("凭证错误：401 且文案不区分原因", async () => {
    h.authenticate.mockResolvedValueOnce(null);
    const res = await post({ username: "ghost", password: "nope" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("用户名或密码不正确");
  });

  it("超限频：429", async () => {
    h.rateLimited = true;
    try {
      const res = await post({ username: "alice", password: "whatever" });
      expect(res.status).toBe(429);
    } finally {
      h.rateLimited = false;
    }
  });

  it("非 JSON 请求体：400", async () => {
    const res = await post("not-json");
    expect(res.status).toBe(400);
  });
});
