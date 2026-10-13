import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, listLedgerMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  listLedgerMock: vi.fn(),
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/db/credit-ledger.repo", () => ({
  createCreditLedgerRepo: () => ({ listLedger: listLedgerMock }),
}));

import { GET } from "./route";

function call(admin: unknown, url: string) {
  requireAdminMock.mockResolvedValueOnce(admin);
  return GET(new Request(url) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/points/ledger", () => {
  it("401/403：守卫拒绝", async () => {
    expect(
      (await call({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" }, "http://x")).status,
    ).toBe(401);
    expect(
      (await call({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" }, "http://x")).status,
    ).toBe(403);
    expect(listLedgerMock).not.toHaveBeenCalled();
  });

  it("过滤透传：userId/type/from/to 转换为 Date", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const fixture = { items: [{ id: "l1" }], total: 1, page: 2, pageSize: 10 };
    listLedgerMock.mockResolvedValue(fixture);
    const res = await call(
      { ok: true, userId: "admin-op" },
      "http://x/api/admin/points/ledger?userId=u1&type=adjust&from=2026-10-01T00:00:00.000Z&to=2026-10-12T00:00:00.000Z&page=2&pageSize=10",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
    expect(listLedgerMock).toHaveBeenCalledWith({
      userId: "u1",
      type: "adjust",
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-10-12T00:00:00.000Z"),
      page: 2,
      pageSize: 10,
    });
  });

  it("422：type 非法", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const res = await call(
      { ok: true, userId: "admin-op" },
      "http://x/api/admin/points/ledger?type=bogus",
    );
    expect(res.status).toBe(422);
  });
});
