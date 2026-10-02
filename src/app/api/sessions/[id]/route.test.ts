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

import { DELETE } from "./route";

function del(id: string): Request {
  return new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" });
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
