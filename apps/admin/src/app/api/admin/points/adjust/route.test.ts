import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskError } from "@oops/domain/tasks/task-error";

const { requireAdminMock, adjustCreditsMock, FakeInsufficientCreditsError } = vi.hoisted(() => {
  // InsufficientCreditsError 用本地替身：真模块顶层拉 defaultDb（DATABASE_URL 校验），
  // 与 route.ts 的 instanceof 判定经同一 mock registry 保持同源（vi.mock 提升要求放 hoisted 内）
  class FakeInsufficientCreditsError extends Error {
    name = "InsufficientCreditsError";
  }
  return {
    requireAdminMock: vi.fn(),
    adjustCreditsMock: vi.fn(),
    FakeInsufficientCreditsError,
  };
});

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/domain/credits/service", () => ({
  creditsService: { adjustCredits: adjustCreditsMock },
}));
vi.mock("@oops/db/credit-ledger.repo", () => ({
  InsufficientCreditsError: FakeInsufficientCreditsError,
}));

import { POST } from "./route";

function call(admin: unknown, body: unknown) {
  requireAdminMock.mockResolvedValueOnce(admin);
  return POST(
    new Request("http://localhost:3001/api/admin/points/adjust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/points/adjust", () => {
  it("401/403：守卫拒绝", async () => {
    expect((await call({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" }, {})).status).toBe(401);
    expect((await call({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" }, {})).status).toBe(403);
    expect(adjustCreditsMock).not.toHaveBeenCalled();
  });

  it("422：入参不合法（delta=0 / 缺备注）", async () => {
    const admin = { ok: true, userId: "admin-op" };
    expect((await call(admin, { userId: "u1", delta: 0, note: "x" })).status).toBe(422);
    expect((await call(admin, { userId: "u1", delta: 10 })).status).toBe(422);
    expect(adjustCreditsMock).not.toHaveBeenCalled();
  });

  it("成功：透传 adminId，返回调整后余额", async () => {
    adjustCreditsMock.mockResolvedValueOnce({ balance: 150 });
    const res = await call({ ok: true, userId: "admin-op" }, {
      userId: "u1",
      delta: 50,
      note: "运营发放",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 150 });
    expect(adjustCreditsMock).toHaveBeenCalledWith({
      userId: "u1",
      delta: 50,
      note: "运营发放",
      adminId: "admin-op",
    });
  });

  it("超额扣减：InsufficientCreditsError → 422 INSUFFICIENT_CREDITS", async () => {
    adjustCreditsMock.mockRejectedValueOnce(new FakeInsufficientCreditsError());
    const res = await call({ ok: true, userId: "admin-op" }, {
      userId: "u1",
      delta: -9999,
      note: "超额",
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("服务结构化拒绝 → 422 code=kind", async () => {
    // 输入合法（zod 放行）以触达 service 层，验证路由对 TaskError 的映射
    adjustCreditsMock.mockRejectedValueOnce(
      new TaskError("调整额度须为非零整数（分）", "adjust_amount_invalid"),
    );
    const res = await call({ ok: true, userId: "admin-op" }, {
      userId: "u1",
      delta: 5,
      note: "x",
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("adjust_amount_invalid");
  });
});
