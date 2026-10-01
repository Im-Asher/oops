import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 认证与仓储，验证 401 门槛与 userId 注入，不依赖真实数据库。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  listCalls: [] as string[],
  created: [] as Record<string, unknown>[],
}));

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));
vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    list: vi.fn(async (userId: string) => {
      h.listCalls.push(userId);
      return [{ id: "s1", agentId: "atmosphere-designer", title: "t", userId }];
    }),
    create: vi.fn(async (input: Record<string, unknown>) => {
      h.created.push(input);
      return { id: "s-new", agentId: input.agentId, title: input.title, userId: input.userId };
    }),
  }),
}));

import { GET, POST } from "./route";

function get(): Request {
  return new Request("http://localhost/api/sessions");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/sessions", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.listCalls = [];
    h.created = [];
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(h.listCalls).toHaveLength(0);
  });

  it("以认证 userId 查询会话列表", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(h.listCalls).toEqual(["u1"]);
    const body = (await res.json()) as { sessions: { id: string }[] };
    expect(body.sessions[0]).toMatchObject({ id: "s1" });
  });
});

describe("POST /api/sessions", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.listCalls = [];
    h.created = [];
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await POST(post({ agentId: "atmosphere-designer" }));
    expect(res.status).toBe(401);
    expect(h.created).toHaveLength(0);
  });

  it("创建会话注入认证 userId", async () => {
    const res = await POST(post({ agentId: "poster-designer", title: "海报" }));
    expect(res.status).toBe(200);
    expect(h.created[0]).toMatchObject({ agentId: "poster-designer", title: "海报", userId: "u1" });
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("s-new");
  });
});
