import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 认证 / 仓储 / 存储，验证删除 GC 序列与失败中止语义，不依赖真实数据库与 MinIO。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  sessionRow: null as { id: string; userId: string } | null,
  keys: [] as string[],
  removedKeys: [] as string[],
  removedAssetSessionId: null as string | null,
  removedSessionId: null as string | null,
  failOnKey: null as string | null,
  renamedTitle: null as string | null,
  updatedAgentId: null as string | null,
}));

vi.mock("@/server/agent", () => ({
  agentRegistry: {
    get: (id: string) =>
      id === "atmosphere-designer" || id === "product-photographer" ? { id } : undefined,
  },
}));

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));
vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: vi.fn(async (id: string, userId: string) =>
      h.sessionRow && h.sessionRow.id === id && h.sessionRow.userId === userId
        ? h.sessionRow
        : undefined,
    ),
    rename: vi.fn(async (id: string, title: string) => {
      h.renamedTitle = title;
      return { ...h.sessionRow, id, title };
    }),
    updateAgent: vi.fn(async (id: string, agentId: string) => {
      h.updatedAgentId = agentId;
      return { ...h.sessionRow, id, agentId };
    }),
    remove: vi.fn(async (id: string) => {
      h.removedSessionId = id;
    }),
  }),
}));
vi.mock("@/server/db/asset.repo", () => ({
  createAssetRepo: () => ({
    listKeysBySession: vi.fn(async () => {
      if (h.failOnKey === "__list__") throw new Error("list boom");
      return h.keys;
    }),
    removeBySession: vi.fn(async (sessionId: string) => {
      h.removedAssetSessionId = sessionId;
    }),
  }),
}));
vi.mock("@/server/infra/storage/s3", () => ({
  defaultS3Client: {},
  createStorage: () => ({
    removeObject: vi.fn(async (key: string) => {
      if (h.failOnKey === key) throw new Error("delete boom");
      h.removedKeys.push(key);
    }),
  }),
}));

import { DELETE, PATCH } from "./route";

function del(id: string): Request {
  return new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" });
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/sessions/[id]", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionRow = { id: "s1", userId: "u1" };
    h.keys = ["assets/a.png", "assets/b.jpg"];
    h.removedKeys = [];
    h.removedAssetSessionId = null;
    h.removedSessionId = null;
    h.failOnKey = null;
    h.renamedTitle = null;
    h.updatedAgentId = null;
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(401);
    expect(h.removedSessionId).toBeNull();
  });

  it("会话不存在或不属于当前用户返回 404 且无副作用", async () => {
    h.sessionRow = { id: "s1", userId: "other" };
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(404);
    expect(h.removedKeys).toEqual([]);
    expect(h.removedAssetSessionId).toBeNull();
    expect(h.removedSessionId).toBeNull();
  });

  it("成功：先删全部对象字节，再删资产行与会话行", async () => {
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(h.removedKeys).toEqual(["assets/a.png", "assets/b.jpg"]);
    expect(h.removedAssetSessionId).toBe("s1");
    expect(h.removedSessionId).toBe("s1");
  });

  it("对象删除失败中止：返回 500，会话与资产行保持存在", async () => {
    h.failOnKey = "assets/b.jpg";
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSET_CLEANUP_FAILED");
    expect(h.removedKeys).toEqual(["assets/a.png"]);
    expect(h.removedAssetSessionId).toBeNull();
    expect(h.removedSessionId).toBeNull();
  });
});

describe("PATCH /api/sessions/[id]", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionRow = { id: "s1", userId: "u1" };
    h.renamedTitle = null;
    h.updatedAgentId = null;
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await PATCH(patch("s1", { title: "新标题" }), ctx("s1"));
    expect(res.status).toBe(401);
    expect(h.renamedTitle).toBeNull();
  });

  it("请求体为空对象返回 400", async () => {
    const res = await PATCH(patch("s1", {}), ctx("s1"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID");
  });

  it("非法 JSON 返回 400", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/sessions/s1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
      ctx("s1"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_JSON");
  });

  it("未注册的 agentId 返回 400 且无副作用", async () => {
    const res = await PATCH(patch("s1", { agentId: "unknown-agent" }), ctx("s1"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_AGENT");
    expect(h.updatedAgentId).toBeNull();
  });

  it("会话不存在或不属于当前用户返回 404", async () => {
    h.sessionRow = { id: "s1", userId: "other" };
    const res = await PATCH(patch("s1", { title: "新标题" }), ctx("s1"));
    expect(res.status).toBe(404);
    expect(h.renamedTitle).toBeNull();
  });

  it("仅重命名：更新标题，不动 agentId", async () => {
    const res = await PATCH(patch("s1", { title: "  面霜场景图  " }), ctx("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; agentId: string };
    expect(h.renamedTitle).toBe("面霜场景图");
    expect(h.updatedAgentId).toBeNull();
    expect(body.title).toBe("面霜场景图");
  });

  it("仅重绑：更新 agentId，不动标题", async () => {
    const res = await PATCH(patch("s1", { agentId: "product-photographer" }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(h.updatedAgentId).toBe("product-photographer");
    expect(h.renamedTitle).toBeNull();
    const body = (await res.json()) as { agentId: string };
    expect(body.agentId).toBe("product-photographer");
  });

  it("同时重命名与重绑：两者都生效", async () => {
    const res = await PATCH(
      patch("s1", { title: "新标题", agentId: "product-photographer" }),
      ctx("s1"),
    );
    expect(res.status).toBe(200);
    expect(h.renamedTitle).toBe("新标题");
    expect(h.updatedAgentId).toBe("product-photographer");
  });
});
