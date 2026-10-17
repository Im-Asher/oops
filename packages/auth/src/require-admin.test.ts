import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookieValue } from "./session-cookie";
import {
  requireAdmin,
  requireAdminFromCookieHeader,
} from "./require-admin";

vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({ findById: findByIdMock })),
}));

const findByIdMock = vi.fn<(id: string) => Promise<unknown>>();

const SECRET = "unit-test-secret-0123456789abcdef-unit-test";
const ADMIN_SECRET = "unit-test-admin-secret-0123456789abcdef-unit";
const ADMIN_COOKIE = "oops_admin_session";

function requestWithCookie(value?: string, name = ADMIN_COOKIE): Request {
  const headers = new Headers();
  if (value !== undefined) headers.set("cookie", `${name}=${value}`);
  return new Request("http://localhost/api/admin", { headers });
}

function sessionCookie(userId: string, tv = 0, secret = ADMIN_SECRET): string {
  return createSessionCookieValue({ userId, exp: 1_800_000_000, tv }, secret);
}

function mockAdmin(id = "owner"): void {
  findByIdMock.mockResolvedValue({
    id,
    status: "active",
    tokenVersion: 0,
    role: "admin",
  });
}

beforeEach(() => {
  findByIdMock.mockReset();
  process.env.ADMIN_AUTH_SECRET = ADMIN_SECRET;
  process.env.ADMIN_COOKIE_PATH = "/";
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

  it("仅携带 web 端会话 cookie 判定未认证（两会话互不相认）", async () => {
    const r = await requireAdmin(
      requestWithCookie(sessionCookie("owner", 0, SECRET), "oops_session"),
    );
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("用 web 端密钥签发的 admin cookie 名同样被拒（密钥独立）", async () => {
    const r = await requireAdmin(requestWithCookie(sessionCookie("owner", 0, SECRET)));
    expect(r).toMatchObject({ ok: false, status: 401 });
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

  it("会话指向已删除用户：null → 401，不进 role 判定", async () => {
    findByIdMock.mockResolvedValue(undefined);
    const r = await requireAdmin(requestWithCookie(sessionCookie("ghost")));
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(findByIdMock).toHaveBeenCalledTimes(1);
  });

  it("被降级的管理员（role=user）返回 403（role 每请求实时判定）", async () => {
    findByIdMock.mockResolvedValue({
      id: "demoted",
      status: "active",
      tokenVersion: 0,
      role: "user",
    });
    const r = await requireAdmin(requestWithCookie(sessionCookie("demoted")));
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("admin 放行并带 userId", async () => {
    mockAdmin();
    const r = await requireAdmin(requestWithCookie(sessionCookie("owner")));
    expect(r).toEqual({ ok: true, userId: "owner" });
  });
});

describe("requireAdminFromCookieHeader（cookie 头直达，RSC 无 Request 场景）", () => {
  it("null 头返回 401 且不查库", async () => {
    const r = await requireAdminFromCookieHeader(null);
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("散装 cookie 头（含 web 端会话键）仍取到管理端会话", async () => {
    mockAdmin();
    const r = await requireAdminFromCookieHeader(
      `other=1; oops_session=web-value; ${ADMIN_COOKIE}=${sessionCookie("owner")}; extra=2`,
    );
    expect(r).toEqual({ ok: true, userId: "owner" });
  });

  it("会话失效头（验签失败）返回 401", async () => {
    const r = await requireAdminFromCookieHeader(`${ADMIN_COOKIE}=garbage`);
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("非 admin 头返回 403", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 0,
      role: "user",
    });
    const r = await requireAdminFromCookieHeader(
      `${ADMIN_COOKIE}=${sessionCookie("u1")}`,
    );
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});
