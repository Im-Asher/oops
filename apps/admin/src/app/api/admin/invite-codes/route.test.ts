import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdminMock,
  generateBatchMock,
  listForAdminMock,
  capturedAuditInputs,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  generateBatchMock: vi.fn(),
  listForAdminMock: vi.fn(),
  capturedAuditInputs: [] as unknown[],
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));

vi.mock("@oops/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn("TX") },
}));

vi.mock("@oops/db/invite-code.repo", () => ({
  createInviteCodeRepo: () => ({
    listForAdmin: listForAdminMock,
    generateBatch: generateBatchMock,
  }),
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

import { GET, POST } from "./route";

function req(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedAuditInputs.length = 0;
});

describe("GET /api/admin/invite-codes", () => {
  it("401：未登录", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    const res = await GET(req("http://localhost:3001/api/admin/invite-codes"));
    expect(res.status).toBe(401);
    expect(listForAdminMock).not.toHaveBeenCalled();
  });

  it("403：非管理员", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    const res = await GET(req("http://localhost:3001/api/admin/invite-codes"));
    expect(res.status).toBe(403);
    expect(listForAdminMock).not.toHaveBeenCalled();
  });

  it("放行：透传分页参数并返回派生列表", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const fixture = {
      items: [{ id: "c1", code: "abcd2345", status: "active" }],
      total: 1,
      page: 2,
      pageSize: 5,
    };
    listForAdminMock.mockResolvedValue(fixture);
    const res = await GET(
      req("http://localhost:3001/api/admin/invite-codes?page=2&pageSize=5"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixture);
    expect(listForAdminMock).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
  });

  it("422：分页参数不合法", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const res = await GET(
      req("http://localhost:3001/api/admin/invite-codes?page=0"),
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /api/admin/invite-codes", () => {
  it("401/403：守卫拒绝", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect(
      (await POST(req("http://x", { method: "POST", body: "{}" }))).status,
    ).toBe(401);
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    expect(
      (await POST(req("http://x", { method: "POST", body: "{}" }))).status,
    ).toBe(403);
    expect(generateBatchMock).not.toHaveBeenCalled();
  });

  it("422：数量越界", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const res = await POST(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 0 }),
      }),
    );
    expect(res.status).toBe(422);
    expect(generateBatchMock).not.toHaveBeenCalled();
  });

  it("批量生成成功：审计 invite.create 复用生成结果（含码清单），返回码列表", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    const created = [
      { id: "c1", code: "abcd2345" },
      { id: "c2", code: "efgh5678" },
    ];
    generateBatchMock.mockResolvedValue(created);

    const res = await POST(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count: 2,
          maxUses: 1,
          expiresAt: "2030-01-01T00:00:00.000Z",
          note: "M2 冒烟",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ codes: ["abcd2345", "efgh5678"] });

    expect(generateBatchMock).toHaveBeenCalledWith({
      count: 2,
      maxUses: 1,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      note: "M2 冒烟",
    });
    expect(capturedAuditInputs).toEqual([
      {
        adminUserId: "admin-op",
        action: "invite.create",
        targetType: "invite_code",
        after: {
          count: 2,
          maxUses: 1,
          expiresAt: "2030-01-01T00:00:00.000Z",
          note: "M2 冒烟",
          codes: ["abcd2345", "efgh5678"],
        },
      },
    ]);
  });

  it("缺省口径：maxUses=1、expiresAt 永久、note null", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-op" });
    generateBatchMock.mockResolvedValue([{ id: "c1", code: "abcd2345" }]);
    const res = await POST(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(generateBatchMock).toHaveBeenCalledWith({
      count: 1,
      maxUses: 1,
      expiresAt: null,
      note: null,
    });
  });
});
