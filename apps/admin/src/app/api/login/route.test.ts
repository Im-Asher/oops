import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateAdminMock,
  rateLimitMock,
  clientIpMock,
  auditRecordMock,
} = vi.hoisted(() => ({
  authenticateAdminMock: vi.fn(),
  rateLimitMock: vi.fn(),
  clientIpMock: vi.fn(),
  auditRecordMock: vi.fn(),
}));

vi.mock("@oops/auth/authenticate-admin", () => ({
  authenticateAdmin: authenticateAdminMock,
}));

vi.mock("@oops/auth/rate-limit", () => ({
  rateLimit: rateLimitMock,
  clientIp: clientIpMock,
}));

vi.mock("@oops/db/admin-audit.repo", () => ({
  createAdminAuditRepo: () => ({ record: auditRecordMock }),
}));

import { POST } from "./route";

const BASE = "http://localhost:3001";

function loginRequest(
  body: unknown,
  headers: Record<string, string> = { origin: BASE },
): Request {
  return new Request(`${BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockReturnValue(true);
  clientIpMock.mockReturnValue("1.2.3.4");
  auditRecordMock.mockResolvedValue({});
  // AUTH_SECRET / ADMIN_AUTH_SECRET 占位（验签只需够长）
  process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef-unit-test";
});

describe("POST /api/login", () => {
  it("成功：下发管理端会话 cookie 并落 auth.login 审计", async () => {
    authenticateAdminMock.mockResolvedValue({ userId: "owner", tokenVersion: 2 });
    const res = await POST(loginRequest({ username: "owner", password: "pw" }));

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("oops_admin_session=");
    expect(setCookie).toMatch(/Max-Age=43200/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: "owner",
        action: "auth.login",
        targetType: "user",
        targetId: "owner",
      }),
    );
  });

  it("凭证错误：401 统一文案且不落审计、不下发 cookie", async () => {
    authenticateAdminMock.mockResolvedValue(null);
    const res = await POST(loginRequest({ username: "owner", password: "bad" }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("非 admin 账号：与凭证错误完全一致的响应（不泄漏角色）", async () => {
    authenticateAdminMock.mockResolvedValue(null);
    const wrong = await POST(loginRequest({ username: "u1", password: "pw" }));
    const nonAdmin = await POST(loginRequest({ username: "u1", password: "pw" }));

    expect(nonAdmin.status).toBe(wrong.status);
    await expect(nonAdmin.json()).resolves.toEqual(await wrong.json());
  });

  it("请求体非法（非 JSON / 缺字段）：400", async () => {
    const badJson = await POST(
      new Request(`${BASE}/api/login`, {
        method: "POST",
        headers: { origin: BASE },
        body: "not-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const missing = await POST(loginRequest({ username: "" }));
    expect(missing.status).toBe(400);
    expect(authenticateAdminMock).not.toHaveBeenCalled();
  });

  it("限频：429 且不校验凭证", async () => {
    rateLimitMock.mockReturnValue(false);
    const res = await POST(loginRequest({ username: "owner", password: "pw" }));

    expect(res.status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith("admin-login:1.2.3.4", 10, 60_000);
    expect(authenticateAdminMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("跨源：403 且不下发会话", async () => {
    const res = await POST(
      loginRequest({ username: "owner", password: "pw" }, { origin: "http://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(authenticateAdminMock).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
