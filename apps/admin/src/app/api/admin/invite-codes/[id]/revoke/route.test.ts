import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdminMock,
  revokeMock,
  findByIdMock,
  capturedAuditInputs,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  revokeMock: vi.fn(),
  findByIdMock: vi.fn(),
  capturedAuditInputs: [] as unknown[],
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));

vi.mock("@oops/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn("TX") },
}));

vi.mock("@oops/db/invite-code.repo", () => ({
  createInviteCodeRepo: () => ({
    revoke: revokeMock,
    findById: findByIdMock,
  }),
  // 派生函数用真实实现（revokedAt 非空 → revoked）
  deriveInviteStatus: (row: { revokedAt: Date | null; expiresAt: Date | null }) =>
    row.revokedAt ? "revoked" : "active",
}));

vi.mock("@oops/db/admin-audit.repo", () => ({
  withAudit: vi.fn(async (_runTx: unknown, input: unknown, bizFn: () => Promise<unknown>) => {
    const result = await bizFn();
    capturedAuditInputs.push(
      typeof input === "function" ? (input as (r: unknown) => unknown)(result) : input,
    );
    return result;
  }),
}));

import { POST } from "./route";

function call(admin: unknown, id: string) {
  requireAdminMock.mockResolvedValueOnce(admin);
  return POST(
    new Request(`http://localhost:3001/api/admin/invite-codes/${id}/revoke`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedAuditInputs.length = 0;
});

describe("POST /api/admin/invite-codes/[id]/revoke", () => {
  it("401/403：守卫拒绝", async () => {
    expect(
      (
        await call(
          { ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" },
          "c1",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          { ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" },
          "c1",
        )
      ).status,
    ).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("作废成功：审计 invite.revoke 记 revokedAt 前后值", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const now = new Date("2026-10-12T12:00:00.000Z");
    revokeMock.mockResolvedValue({
      id: "c1",
      code: "abcd2345",
      revokedAt: now,
    });

    const res = await call({ ok: true, userId: "admin-op" }, "c1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyRevoked).toBe(false);
    expect(revokeMock).toHaveBeenCalledWith("c1");
    expect(capturedAuditInputs).toEqual([
      {
        adminUserId: "admin-op",
        action: "invite.revoke",
        targetType: "invite_code",
        targetId: "c1",
        before: { revokedAt: null },
        after: { revokedAt: now.toISOString() },
      },
    ]);
  });

  it("已作废：幂等成功不重复落审计", async () => {
    const existing = { id: "c1", code: "abcd2345", revokedAt: new Date() };
    revokeMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue(existing);

    const res = await call({ ok: true, userId: "admin-op" }, "c1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyRevoked).toBe(true);
    expect(findByIdMock).toHaveBeenCalledWith("c1");
    expect(capturedAuditInputs).toEqual([]); // 幂等路径无审计
  });

  it("不存在：404", async () => {
    revokeMock.mockResolvedValue(undefined);
    findByIdMock.mockResolvedValue(undefined);

    const res = await call({ ok: true, userId: "admin-op" }, "missing");
    expect(res.status).toBe(404);
  });
});
