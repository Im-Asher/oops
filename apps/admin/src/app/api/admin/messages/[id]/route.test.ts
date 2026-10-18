import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const h = vi.hoisted(() => ({ requireAdminMock: vi.fn(), detailMock: vi.fn() }));

vi.mock("@oops/auth", () => ({ requireAdmin: h.requireAdminMock }));
vi.mock("@oops/domain/notifications/service", () => ({
  notificationsService: { getAdminDetail: h.detailMock },
}));

function call(id: string): Promise<Response> {
  return GET(new Request(`http://localhost:3001/api/admin/messages/${id}`) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/messages/:id", () => {
  it("401/403：守卫拒绝", async () => {
    for (const guard of [
      { ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" },
      { ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" },
    ]) {
      h.requireAdminMock.mockResolvedValueOnce(guard);
      const res = await call("m1");
      expect(res.status).toBe(guard.status);
    }
    expect(h.detailMock).not.toHaveBeenCalled();
  });

  it("404：消息不存在", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.detailMock.mockResolvedValueOnce(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("200：返回统计与已读明细，时间转 ISO；已撤回仍可查", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.detailMock.mockResolvedValueOnce({
      notification: {
        id: "m1",
        source: "admin",
        category: "admin.broadcast",
        level: "info",
        title: "t",
        body: "b",
        audience: "all",
        createdBy: "admin-1",
        revokedAt: new Date("2026-10-18T09:00:00.000Z"),
        createdAt: new Date("2026-10-18T08:00:00.000Z"),
        targetCount: 7,
        readCount: 1,
      },
      readBy: [
        {
          userId: "u1",
          username: "alice",
          displayName: "Alice",
          readAt: new Date("2026-10-18T08:30:00.000Z"),
        },
      ],
    });
    const res = await call("m1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notification.createdAt).toBe("2026-10-18T08:00:00.000Z");
    expect(body.notification.revokedAt).toBe("2026-10-18T09:00:00.000Z");
    expect(body.notification.readCount).toBe(1);
    expect(body.readBy[0]).toEqual({
      userId: "u1",
      username: "alice",
      displayName: "Alice",
      readAt: "2026-10-18T08:30:00.000Z",
    });
  });
});
