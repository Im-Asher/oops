import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, statsMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  statsMock: vi.fn(),
}));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/db", () => ({
  db: Symbol("db"),
  getTaskDashboardStats: statsMock,
}));

import { GET } from "./route";

const admin = { ok: true, userId: "admin-op" };
const statsFixture = {
  statusCounts: { pending: 2, running: 1, succeeded: 10, failed: 3, canceled: 0 },
  window: {
    startedAt: new Date("2026-10-13T10:00:00Z"),
    terminalCount: 13,
    failedCount: 3,
    failureRate: 3 / 13,
    avgDurationMs: 4_200,
  },
  recentFailures: [
    {
      id: "t-1",
      type: "generate_image",
      status: "failed",
      error: "provider timeout",
      sessionId: "s-1",
      userId: "u-1",
      createdAt: new Date("2026-10-13T11:00:00Z"),
      updatedAt: new Date("2026-10-13T11:01:00Z"),
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/dashboard/tasks", () => {
  it("401/403：守卫拒绝", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect((await GET(new Request("http://x") as never)).status).toBe(401);
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    expect((await GET(new Request("http://x") as never)).status).toBe(403);
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("200：状态分布 + 窗口指标 + 最近失败（日期 ISO 化）", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    statsMock.mockResolvedValueOnce(statsFixture);
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      statusCounts: Record<string, number>;
      window: { startedAt: string; failureRate: number; avgDurationMs: number };
      recentFailures: Array<{ id: string; error: string; createdAt: string }>;
    };
    expect(body.statusCounts).toEqual(statsFixture.statusCounts);
    expect(body.window.startedAt).toBe("2026-10-13T10:00:00.000Z");
    expect(body.window.failureRate).toBeCloseTo(3 / 13, 10);
    expect(body.window.avgDurationMs).toBe(4_200);
    expect(body.recentFailures[0]).toMatchObject({ id: "t-1", error: "provider timeout", createdAt: "2026-10-13T11:00:00.000Z" });
    // statsMock 收到 db 与 24h 窗口
    expect(statsMock).toHaveBeenCalledWith(expect.anything(), 24);
  });

  it("500：聚合查询抛错透传（next 统一 500）", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    statsMock.mockRejectedValueOnce(new Error("db down"));
    await expect(GET(new Request("http://x") as never)).rejects.toThrow("db down");
  });
});
