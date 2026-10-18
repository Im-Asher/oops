import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const h = vi.hoisted(() => {
  // NotificationError 用本地替身：真模块顶层拉 defaultDb（DATABASE_URL 校验），
  // 与 route.ts 的 instanceof 判定经同一 mock registry 保持同源
  class FakeNotificationError extends Error {
    constructor(
      message: string,
      readonly kind: string,
    ) {
      super(message);
      this.name = "NotificationError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    sendMock: vi.fn(),
    listMock: vi.fn(),
    FakeNotificationError,
  };
});

vi.mock("@oops/auth", () => ({ requireAdmin: h.requireAdminMock }));
// 常量按真实取值提供（zod schema 依赖它们），模块本体替身以避开导入期 DB 校验
vi.mock("@oops/db/notification.repo", () => ({
  NOTIFICATION_AUDIENCES: ["all", "users"],
  NOTIFICATION_LEVELS: ["info", "warning", "critical"],
  NOTIFICATION_SOURCES: ["system", "admin"],
}));
vi.mock("@oops/domain/notifications/service", () => ({
  NotificationError: h.FakeNotificationError,
  notificationsService: { send: h.sendMock, listForAdmin: h.listMock },
}));

function post(body: unknown): Request {
  return new Request("http://localhost:3001/api/admin/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function list(query = ""): Request {
  return new Request(`http://localhost:3001/api/admin/messages${query}`) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/messages", () => {
  it("401/403：守卫拒绝", async () => {
    for (const guard of [
      { ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" },
      { ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" },
    ]) {
      h.requireAdminMock.mockResolvedValueOnce(guard);
      const res = await POST(post({ audience: "all", title: "t", body: "b" }));
      expect(res.status).toBe(guard.status);
      expect((await res.json()).error.code).toBe(guard.code);
    }
    expect(h.sendMock).not.toHaveBeenCalled();
  });

  it("422：定向发送未选人被拒", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    const res = await POST(post({ audience: "users", title: "t", body: "b" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_PARAMS");
    expect(h.sendMock).not.toHaveBeenCalled();
  });

  it("422：标题或正文为空、来源取值非法", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    expect((await POST(post({ audience: "all", title: "", body: "b" }))).status).toBe(422);
    expect((await POST(post({ audience: "all", title: "t", body: "" }))).status).toBe(422);
    expect((await POST(post({ audience: "all", title: "t", body: "b", level: "fatal" }))).status).toBe(422);
  });

  it("201：全体广播 → admin.broadcast，并透传 adminId", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.sendMock.mockResolvedValueOnce({ id: "m1", targetCount: 7 });
    const res = await POST(
      post({ audience: "all", title: "停机维护", body: "今晚 02:00", level: "warning" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "m1", targetCount: 7 });
    expect(h.sendMock).toHaveBeenCalledWith({
      source: "admin",
      category: "admin.broadcast",
      level: "warning",
      title: "停机维护",
      body: "今晚 02:00",
      audience: "all",
      userIds: undefined,
      adminId: "admin-1",
      note: undefined,
    });
  });

  it("201：定向发送 → admin.direct，缺省 level 为 info", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.sendMock.mockResolvedValueOnce({ id: "m2", targetCount: 2 });
    const res = await POST(
      post({ audience: "users", userIds: ["u1", "u2"], title: "hi", body: "yo", note: "运营" }),
    );
    expect(res.status).toBe(201);
    expect(h.sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "admin.direct",
        level: "info",
        userIds: ["u1", "u2"],
        note: "运营",
      }),
    );
  });

  it("422：领域层 no_receivable_user 映射为 422", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.sendMock.mockRejectedValueOnce(
      new h.FakeNotificationError("当前没有可接收的用户", "no_receivable_user"),
    );
    const res = await POST(post({ audience: "all", title: "t", body: "b" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_receivable_user");
  });

  it("非领域错误向上抛（不吞异常）", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.sendMock.mockRejectedValueOnce(new Error("db down"));
    await expect(POST(post({ audience: "all", title: "t", body: "b" }))).rejects.toThrow("db down");
  });
});

describe("GET /api/admin/messages", () => {
  it("401：守卫拒绝", async () => {
    h.requireAdminMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "未登录",
    });
    expect((await GET(list())).status).toBe(401);
    expect(h.listMock).not.toHaveBeenCalled();
  });

  it("400：非法过滤参数", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    expect((await GET(list("?source=nope"))).status).toBe(400);
    expect((await GET(list("?page=0"))).status).toBe(400);
  });

  it("200：缺省只查未撤回，并把 Date 转 ISO", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.listMock.mockResolvedValueOnce({
      items: [
        {
          id: "m1",
          source: "admin",
          category: "admin.broadcast",
          level: "info",
          title: "t",
          body: "b",
          audience: "all",
          createdBy: "admin-1",
          revokedAt: null,
          createdAt: new Date("2026-10-18T08:00:00.000Z"),
          targetCount: 7,
          readCount: 3,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const res = await GET(list());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].createdAt).toBe("2026-10-18T08:00:00.000Z");
    expect(body.items[0].revokedAt).toBeNull();
    expect(body.items[0].targetCount).toBe(7);
    expect(body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(h.listMock).toHaveBeenCalledWith({
      source: undefined,
      keyword: undefined,
      revoked: "active",
      page: 1,
      pageSize: 20,
    });
  });

  it("200：筛选参数透传（来源 / 关键词 / 撤回态）", async () => {
    h.requireAdminMock.mockResolvedValue({ ok: true, userId: "admin-1" });
    h.listMock.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 10 });
    const res = await GET(list("?source=admin&keyword=维护&revoked=all&page=2&pageSize=10"));
    expect(res.status).toBe(200);
    expect(h.listMock).toHaveBeenCalledWith({
      source: "admin",
      keyword: "维护",
      revoked: "all",
      page: 2,
      pageSize: 10,
    });
  });
});
