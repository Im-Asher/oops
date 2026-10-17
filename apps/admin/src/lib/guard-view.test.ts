import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookieValue } from "@oops/auth";
import { resolveGuardView } from "./guard-view";

vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({ findById: findByIdMock })),
}));

// auth 全量入口（index）经 register.ts 顶层拉起 @oops/db index（顶层建 pg Pool、
// 依赖 DATABASE_URL）——本测试只需要 session-cookie 与 require-admin 链路，
// 将 db index mock 掉以避免加载真实连接池。
vi.mock("@oops/db", () => ({ db: {} }));

const findByIdMock = vi.fn<(id: string) => Promise<unknown>>();

// 与 @oops/config 的密钥长度校验一致（≥32 字符）；守卫读管理端专用密钥与 cookie 名
const SECRET = "admin-test-secret-0123456789abcdef";
process.env.AUTH_SECRET = SECRET;
process.env.ADMIN_AUTH_SECRET = SECRET;

function cookie(value: string): string {
  return `oops_admin_session=${value}`;
}

function session(userId: string, tv = 0): string {
  return createSessionCookieValue(
    { userId, exp: 1_800_000_000, tv },
    SECRET,
  );
}

beforeEach(() => {
  findByIdMock.mockReset();
});

describe("resolveGuardView（布局层三分支映射）", () => {
  it("ok 结果 → null（放行）", () => {
    expect(resolveGuardView({ ok: true, userId: "u1" })).toBeNull();
  });

  it("401 → expired（会话失效引导页）", () => {
    expect(
      resolveGuardView({
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "请先登录",
      }),
    ).toBe("expired");
  });

  it("403 → forbidden（antd Result 无权限页）", () => {
    expect(
      resolveGuardView({
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "需要管理员权限",
      }),
    ).toBe("forbidden");
  });
});

describe("ghost 用户语义（经真实守卫核心）", () => {
  it("会话指向已删除用户 → requireAdmin 层 401 → expired", async () => {
    const { requireAdminFromCookieHeader } = await import("@oops/auth");
    findByIdMock.mockResolvedValue(undefined);
    const result = await requireAdminFromCookieHeader(cookie(session("ghost")));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(resolveGuardView(result)).toBe("expired");
  });

  it("非 admin 用户 → 403 → forbidden", async () => {
    const { requireAdminFromCookieHeader } = await import("@oops/auth");
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 0,
      role: "user",
    });
    const result = await requireAdminFromCookieHeader(cookie(session("u1")));
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(resolveGuardView(result)).toBe("forbidden");
  });
});
