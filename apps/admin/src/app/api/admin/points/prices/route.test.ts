import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskError } from "@oops/domain/tasks/task-error";

const { requireAdminMock, listPricesMock, getPriceMock, setTaskPriceMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  listPricesMock: vi.fn(),
  getPriceMock: vi.fn(),
  setTaskPriceMock: vi.fn(),
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/domain/credits/service", () => ({
  creditsService: { setTaskPrice: setTaskPriceMock },
}));
vi.mock("@oops/db/credit-ledger.repo", () => ({
  createCreditLedgerRepo: () => ({ listPrices: listPricesMock, getPrice: getPriceMock }),
}));

import { GET, PUT } from "./route";

function get(admin: unknown) {
  requireAdminMock.mockResolvedValueOnce(admin);
  return GET(new Request("http://x") as never);
}

function put(admin: unknown, body: unknown) {
  requireAdminMock.mockResolvedValueOnce(admin);
  return PUT(
    new Request("http://x/api/admin/points/prices", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/points/prices", () => {
  it("401/403：守卫拒绝", async () => {
    expect((await get({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" })).status).toBe(401);
    expect((await get({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" })).status).toBe(403);
    expect(listPricesMock).not.toHaveBeenCalled();
  });

  it("返回价目清单", async () => {
    const fixture = { items: [{ key: "generate_image", credits: 10 }] };
    listPricesMock.mockResolvedValueOnce(fixture.items);
    const res = await get({ ok: true, userId: "admin-op" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
  });
});

describe("PUT /api/admin/points/prices", () => {
  it("401/403：守卫拒绝", async () => {
    expect((await put({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" }, {})).status).toBe(401);
    expect((await put({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" }, {})).status).toBe(403);
    expect(setTaskPriceMock).not.toHaveBeenCalled();
  });

  it("422：入参不合法（负数/非整数单价）", async () => {
    const admin = { ok: true, userId: "admin-op" };
    expect((await put(admin, { key: "k", credits: -1 })).status).toBe(422);
    expect((await put(admin, { key: "k", credits: 1.5 })).status).toBe(422);
    expect(setTaskPriceMock).not.toHaveBeenCalled();
  });

  it("改价成功：透传 adminId，回读新价", async () => {
    setTaskPriceMock.mockResolvedValueOnce(undefined);
    getPriceMock.mockResolvedValueOnce(15);
    const res = await put({ ok: true, userId: "admin-op" }, {
      key: "generate_image",
      credits: 15,
      note: "涨价",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ price: { key: "generate_image", credits: 15 } });
    expect(setTaskPriceMock).toHaveBeenCalledWith({
      key: "generate_image",
      credits: 15,
      note: "涨价",
      adminId: "admin-op",
    });
  });

  it("服务结构化拒绝 → 422 code=kind", async () => {
    // 输入合法（zod 放行）以触达 service 层，验证路由对 TaskError 的映射
    setTaskPriceMock.mockRejectedValueOnce(new TaskError("单价须为非负整数（分）", "pricing_invalid"));
    const res = await put({ ok: true, userId: "admin-op" }, { key: "k", credits: 5 });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("pricing_invalid");
  });
});
