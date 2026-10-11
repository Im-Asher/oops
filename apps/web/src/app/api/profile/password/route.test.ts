import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  changePassword: vi.fn(),
  rateLimited: false,
}));

vi.mock("@/server/auth/require-user", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/profile/profile", () => ({
  changePassword: h.changePassword,
}));
vi.mock("@/server/auth/rate-limit", () => ({
  rateLimit: () => !h.rateLimited,
  clientIp: () => "test-ip",
}));

import { POST } from "./route";

beforeEach(() => {
  h.requireUser.mockReset();
  h.changePassword.mockReset();
  h.rateLimited = false;
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/profile/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/profile/password", () => {
  it("改密成功：下发携带新版本的 cookie，当前端保持登录", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    h.changePassword.mockResolvedValueOnce({ ok: true, tokenVersion: 3 });
    const res = await post({ currentPassword: "old", newPassword: "12345678" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("oops_session=");
    const token = cookie.split(";")[0].split("=").slice(1).join("=");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString(),
    ) as { userId: string; tv: number };
    expect(payload).toMatchObject({ userId: "u1", tv: 3 });
  });

  it("当前密码错误：400 人话文案，服务层已拒绝", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    h.changePassword.mockResolvedValueOnce({ ok: false, reason: "wrong_current" });
    const res = await post({ currentPassword: "bad", newPassword: "12345678" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("当前密码不正确");
  });

  it("新密码过短：400 且不触达服务层", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    const res = await post({ currentPassword: "old", newPassword: "123" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("新密码至少 8 位");
    expect(h.changePassword).not.toHaveBeenCalled();
  });

  it("401 未认证", async () => {
    h.requireUser.mockResolvedValueOnce(null);
    const res = await post({ currentPassword: "old", newPassword: "12345678" });
    expect(res.status).toBe(401);
  });

  it("超限频：429", async () => {
    h.requireUser.mockResolvedValue("u1");
    h.rateLimited = true;
    try {
      const res = await post({ currentPassword: "old", newPassword: "12345678" });
      expect(res.status).toBe(429);
    } finally {
      h.rateLimited = false;
    }
  });

  it("非 JSON 请求体：400", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    const res = await post("not-json");
    expect(res.status).toBe(400);
  });
});
