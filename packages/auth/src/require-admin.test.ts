import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookieValue } from "./session-cookie";
import { requireAdmin } from "./require-admin";

vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({ findById: findByIdMock })),
}));

const findByIdMock = vi.fn<(id: string) => Promise<unknown>>();

const SECRET = "unit-test-secret-0123456789abcdef-unit-test";

function requestWithCookie(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) headers.set("cookie", `oops_session=${value}`);
  return new Request("http://localhost/api/admin", { headers });
}

function sessionCookie(userId: string, tv = 0): string {
  return createSessionCookieValue({ userId, exp: 1_800_000_000, tv }, SECRET);
}

beforeEach(() => {
  findByIdMock.mockReset();
});

describe("requireAdmin", () => {
  it("未认证（无 cookie）返回 401 且不查库", async () => {
    const r = await requireAdmin(requestWithCookie(undefined));
    expect(r).toEqual({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("已认证非 admin 返回 403", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 0,
      role: "user",
    });
    const r = await requireAdmin(requestWithCookie(sessionCookie("u1")));
    expect(r).toEqual({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    });
  });

  it("会话指向已删除用户：requireUser 层即拒（null → 401），不进 role 判定", async () => {
    findByIdMock.mockResolvedValue(undefined);
    const r = await requireAdmin(requestWithCookie(sessionCookie("ghost")));
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(findByIdMock).toHaveBeenCalledTimes(1);
  });

  it("admin 放行并带 userId", async () => {
    findByIdMock.mockResolvedValue({
      id: "owner",
      status: "active",
      tokenVersion: 0,
      role: "admin",
    });
    const r = await requireAdmin(requestWithCookie(sessionCookie("owner")));
    expect(r).toEqual({ ok: true, userId: "owner" });
  });
});
