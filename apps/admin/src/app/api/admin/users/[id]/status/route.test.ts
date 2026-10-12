import { beforeEach, describe, expect, it, vi } from "vitest";

const findByIdMock = vi.fn();
const setStatusMock = vi.fn();
const recordMock = vi.fn();

vi.mock("@oops/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@oops/db", () => ({
  db: { transaction: (fn: (tx: string) => Promise<unknown>) => fn("TX") },
}));
vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({
    findById: findByIdMock,
    setStatus: setStatusMock,
  })),
}));
vi.mock("@oops/db/admin-audit.repo", () => ({
  createAdminAuditRepo: vi.fn(() => ({ record: recordMock })),
  withAudit: vi.fn(), // 占位避免模块形状不完整；真实 withAudit 逻辑经集成验证
}));

import { requireAdmin } from "@oops/auth";
import { PATCH } from "./route";

const USER = { id: "u1", status: "active", username: "alice" };

const call = (operatorId: string, targetId: string, body: object) =>
  PATCH(new Request(`http://localhost/api/admin/users/${targetId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: targetId }) });

describe("PATCH /api/admin/users/[id]/status", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    findByIdMock.mockReset();
    setStatusMock.mockReset();
    recordMock.mockReset();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin-op" });
    setStatusMock.mockResolvedValue({ ...USER, status: "disabled" });
  });

  it("未认证 401 / 非 admin 403，不执行业务", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
    expect((await call("admin-op", "u1", { status: "disabled" })).status).toBe(401);
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    });
    expect((await call("admin-op", "u1", { status: "disabled" })).status).toBe(403);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("自禁被拒 422 且零副作用", async () => {
    const res = await call("admin-op", "admin-op", { status: "disabled" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SELF_DISABLE_FORBIDDEN");
    expect(setStatusMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("停用成功：审计含真实前后状态，返回更新后用户", async () => {
    findByIdMock.mockResolvedValue(USER);
    const res = await call("admin-op", "u1", { status: "disabled" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { ...USER, status: "disabled" } });
    expect(recordMock).toHaveBeenCalledWith({
      adminUserId: "admin-op",
      action: "user.status_change",
      targetType: "user",
      targetId: "u1",
      before: { status: "active" },
      after: { status: "disabled" },
    });
  });

  it("用户不存在：404 且不落审计（业务回滚语义）", async () => {
    findByIdMock.mockResolvedValue(undefined);
    const res = await call("admin-op", "ghost", { status: "disabled" });
    expect(res.status).toBe(404);
    expect(recordMock).not.toHaveBeenCalled();
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("非法请求体 400", async () => {
    const res = await call("admin-op", "u1", { status: "banned" });
    expect(res.status).toBe(400);
    expect(setStatusMock).not.toHaveBeenCalled();
  });

  it("启用自己：允许（自禁仅限停用方向）", async () => {
    findByIdMock.mockResolvedValue({ ...USER, status: "disabled" });
    setStatusMock.mockResolvedValue(USER);
    const res = await call("admin-op", "admin-op", { status: "active" });
    expect(res.status).toBe(200);
  });
});
