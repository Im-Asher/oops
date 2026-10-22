import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const h = vi.hoisted(() => {
  class FakeNotificationError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
      this.name = "NotificationError";
    }
  }
  return { requireAdminMock: vi.fn(), revokeMock: vi.fn(), FakeNotificationError };
});

vi.mock("@oops/auth", () => ({ requireAdmin: h.requireAdminMock }));
vi.mock("@oops/domain/notifications/service", () => ({
  NotificationError: h.FakeNotificationError,
  notificationsService: { revoke: h.revokeMock },
}));

function call(id: string, body?: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost:3001/api/admin/messages/${id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/messages/:id/revoke", () => {
  it("401/403：守卫拒绝", async () => {
    for (const guard of [
      { ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" },
      { ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" },
    ]) {
      h.requireAdminMock.mockResolvedValueOnce(guard);
      expect((await call("m1")).status).toBe(guard.status);
    }
    expect(h.revokeMock).not.toHaveBeenCalled();
  });

  it("200：撤回成功并透传 adminId 与 note", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    const revokedAt = new Date("2026-10-18T09:00:00.000Z");
    h.revokeMock.mockResolvedValueOnce({ revokedAt });
    const res = await call("m1", { note: "发错了" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revokedAt: "2026-10-18T09:00:00.000Z" });
    expect(h.revokeMock).toHaveBeenCalledWith({
      id: "m1",
      adminId: "admin-1",
      note: "发错了",
    });
  });

  it("200：无 body 也能撤回（note 缺省）", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.revokeMock.mockResolvedValueOnce({ revokedAt: new Date() });
    const res = await call("m1");
    expect(res.status).toBe(200);
    expect(h.revokeMock).toHaveBeenCalledWith({ id: "m1", adminId: "admin-1", note: undefined });
  });

  it("409：已撤回被拒（幂等拒绝）", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.revokeMock.mockRejectedValueOnce(
      new h.FakeNotificationError("消息已撤回，不可重复撤回", "already_revoked"),
    );
    const res = await call("m1");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("already_revoked");
  });

  it("404：消息不存在", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.revokeMock.mockRejectedValueOnce(
      new h.FakeNotificationError("消息不存在", "not_found"),
    );
    const res = await call("nope");
    expect(res.status).toBe(404);
  });
});
