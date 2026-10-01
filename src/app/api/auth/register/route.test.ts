import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  registerUser: vi.fn(),
  rateLimited: false,
}));

vi.mock("@/server/auth/register", () => ({
  registerUser: h.registerUser,
}));
vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(async () => "HASH"),
}));
vi.mock("@/server/auth/rate-limit", () => ({
  rateLimit: () => !h.rateLimited,
  clientIp: () => "test-ip",
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const okResult = {
  ok: true,
  user: { id: "u1", username: "alice" },
} as const;

describe("POST /api/auth/register", () => {
  it("注册成功：201 + 签发会话 cookie，服务层收到哈希后的密码", async () => {
    h.registerUser.mockResolvedValueOnce(okResult);
    const res = await post({ username: "alice", password: "12345678", inviteCode: "CODE-1" });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("oops_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(h.registerUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: "alice", passwordHash: "HASH", inviteCode: "CODE-1" }),
    );
  });

  it("邀请码无效或已用尽：400 人话文案", async () => {
    h.registerUser.mockResolvedValueOnce({ ok: false, reason: "invite_code_invalid" });
    const res = await post({ username: "alice", password: "12345678", inviteCode: "BAD" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("邀请码无效或已被使用");
  });

  it("用户名已存在：409", async () => {
    h.registerUser.mockResolvedValueOnce({ ok: false, reason: "username_taken" });
    const res = await post({ username: "alice", password: "12345678", inviteCode: "CODE-1" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("用户名已存在");
  });

  it("密码过短：400 且不触达服务层", async () => {
    const res = await post({ username: "alice", password: "123", inviteCode: "CODE-1" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("密码至少 8 位");
    expect(h.registerUser).not.toHaveBeenCalled();
  });

  it("非 JSON 请求体：400", async () => {
    const res = await post("not-json");
    expect(res.status).toBe(400);
  });

  it("超限频：429", async () => {
    h.rateLimited = true;
    try {
      const res = await post({ username: "alice", password: "12345678", inviteCode: "CODE-1" });
      expect(res.status).toBe(429);
    } finally {
      h.rateLimited = false;
    }
  });
});
