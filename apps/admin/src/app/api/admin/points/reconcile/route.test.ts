import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, reconcileBalancesMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  reconcileBalancesMock: vi.fn(),
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/db/credit-ledger.repo", () => ({
  createCreditLedgerRepo: () => ({ reconcileBalances: reconcileBalancesMock }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/points/reconcile", () => {
  it("401/403：守卫拒绝", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(401);
    expect(reconcileBalancesMock).not.toHaveBeenCalled();
  });

  it("全部一致：consistent=true、mismatches 空", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: true, userId: "admin-op" });
    reconcileBalancesMock.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ consistent: true, total: 0, mismatches: [] });
  });

  it("存在不一致：返回逐条差异", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: true, userId: "admin-op" });
    reconcileBalancesMock.mockResolvedValueOnce([
      { userId: "u2", username: "bob", balance: 30, ledgerSum: 25 },
    ]);
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      consistent: false,
      total: 1,
      mismatches: [{ userId: "u2", username: "bob", balance: 30, ledgerSum: 25 }],
    });
  });
});
