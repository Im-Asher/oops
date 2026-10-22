import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 认证与 domain 服务，验证鉴权、参数校验与响应形状。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  items: [] as Array<Record<string, unknown>>,
  total: 0,
  unread: 0,
  markReadResult: true,
  markAllReadCount: 0,
  listArgs: [] as Array<Record<string, unknown>>,
  markReadArgs: [] as Array<[string, string]>,
  markAllReadArgs: [] as string[],
}));

vi.mock("@oops/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));
vi.mock("@oops/domain/notifications/service", () => ({
  notificationsService: {
    listForUser: vi.fn(async (args: Record<string, unknown>) => {
      h.listArgs.push(args);
      return { items: h.items, total: h.total, page: 1, pageSize: 20 };
    }),
    unreadCount: vi.fn(async () => h.unread),
    markRead: vi.fn(async (userId: string, id: string) => {
      h.markReadArgs.push([userId, id]);
      return h.markReadResult;
    }),
    markAllRead: vi.fn(async (userId: string) => {
      h.markAllReadArgs.push(userId);
      return h.markAllReadCount;
    }),
  },
}));

const REQ = () => new Request("http://localhost/api/notifications");

beforeEach(() => {
  h.userId = "u1";
  h.items = [];
  h.total = 0;
  h.unread = 0;
  h.markReadResult = true;
  h.markAllReadCount = 0;
  h.listArgs = [];
  h.markReadArgs = [];
  h.markAllReadArgs = [];
});

describe("GET /api/notifications", () => {
  it("未认证返回 401", async () => {
    h.userId = null;
    const { GET } = await import("./route");
    const res = await GET(REQ());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("返回拍平后的列表与分页信息", async () => {
    const { GET } = await import("./route");
    h.items = [
      {
        id: "n1",
        source: "system",
        category: "credits.low",
        level: "warning",
        title: "积分即将耗尽",
        body: "余额 15",
        i18nKey: "notifications.credits.low",
        i18nParams: { balance: 15 },
        createdAt: new Date("2026-10-18T00:00:00Z"),
        readAt: null,
      },
    ];
    h.total = 1;
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: "n1", readAt: null });
    // Date 序列化为 ISO 字符串
    expect(body.items[0].createdAt).toBe("2026-10-18T00:00:00.000Z");
    expect(h.listArgs[0]).toMatchObject({ userId: "u1", page: 1, pageSize: 20 });
  });

  it("非法分页参数返回 400", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/notifications?pageSize=999"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID");
  });

  it("按来源筛选透传 service", async () => {
    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/notifications?source=admin"));
    expect(h.listArgs[0]).toMatchObject({ source: "admin" });
  });
});

describe("GET /api/notifications/unread-count", () => {
  it("未认证返回 401", async () => {
    h.userId = null;
    const { GET } = await import("./unread-count/route");
    expect((await GET(REQ())).status).toBe(401);
  });

  it("返回未读计数", async () => {
    const { GET } = await import("./unread-count/route");
    h.unread = 3;
    const res = await GET(REQ());
    expect(res.status).toBe(200);
    expect((await res.json()).unreadCount).toBe(3);
  });
});

describe("PATCH /api/notifications/[id]", () => {
  const params = Promise.resolve({ id: "n1" });
  const patchReq = (body: string) =>
    new Request("http://localhost/api/notifications/n1", { method: "PATCH", body });

  it("未认证返回 401", async () => {
    h.userId = null;
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(patchReq(JSON.stringify({ read: true })), { params });
    expect(res.status).toBe(401);
  });

  it("标记成功并回传最新未读数", async () => {
    const { PATCH } = await import("./[id]/route");
    h.unread = 1;
    const res = await PATCH(patchReq(JSON.stringify({ read: true })), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).unreadCount).toBe(1);
    expect(h.markReadArgs[0]).toEqual(["u1", "n1"]);
  });

  it("非本人投递或已撤回回 404", async () => {
    const { PATCH } = await import("./[id]/route");
    h.markReadResult = false;
    const res = await PATCH(patchReq(JSON.stringify({ read: true })), { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("请求体非法返回 400（非 JSON / read 非 true）", async () => {
    const { PATCH } = await import("./[id]/route");
    const bad = await PATCH(patchReq("{"), { params });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("BAD_JSON");

    const invalid = await PATCH(patchReq(JSON.stringify({ read: false })), { params });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("INVALID");
  });
});

describe("POST /api/notifications/read-all", () => {
  it("未认证返回 401", async () => {
    h.userId = null;
    const { POST } = await import("./read-all/route");
    expect((await POST(REQ())).status).toBe(401);
  });

  it("返回本次标记条数", async () => {
    const { POST } = await import("./read-all/route");
    h.markAllReadCount = 4;
    const res = await POST(REQ());
    expect(res.status).toBe(200);
    expect((await res.json()).marked).toBe(4);
    expect(h.markAllReadArgs[0]).toBe("u1");
  });
});