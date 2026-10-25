import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 认证/仓储/存储/事务，验证收藏、覆盖式标签、彻底删除与越权语义。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  ownedRow: undefined as
    | { id: string; title: string | null; savedAt: Date | null; storageKey?: string; mimeType?: string; width?: number | null; height?: number | null; kind?: string }
    | undefined,
  ownedKey: undefined as string | undefined,
  setSavedArgs: [] as unknown[],
  removedAssetId: null as string | null,
  removedObjectKey: null as string | null,
  failRemoveObject: false,
  txEffect: null as null | (() => void),
  clearCalls: [] as string[],
  linkCalls: [] as { assetId: string; tagIds: string[] }[],
  createdTags: [] as string[],
  tagRows: [] as { assetId: string; tagId: string; name: string }[],
  txError: null as Error | null,
}));

vi.mock("@oops/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));

vi.mock("@oops/db", () => ({
  // 事务 stub：Proxy mock 无法驱动事务流，直接以链式 stub 执行回调
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (h.txEffect) h.txEffect();
      if (h.txError) throw h.txError;
      return fn({ __tx: true });
    },
  },
}));

vi.mock("@oops/db/asset.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oops/db/asset.repo")>();
  return {
    ...actual,
    createAssetRepo: () => ({
      getSaved: vi.fn(async () => h.ownedRow),
      setSaved: vi.fn(async (_id: string, _userId: string, update: unknown) => {
        h.setSavedArgs.push(update);
        return h.ownedRow;
      }),
      getOwnedKey: vi.fn(async () => h.ownedKey),
      remove: vi.fn(async (id: string) => {
        h.removedAssetId = id;
      }),
    }),
  };
});

vi.mock("@oops/db/tag.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oops/db/tag.repo")>();
  return {
    ...actual,
    createTagRepo: () => ({
      findOrCreate: vi.fn(async (name: string) => {
        if (h.txError) throw h.txError;
        h.createdTags.push(name);
        return { id: `t-${name}`, name };
      }),
      clearForAsset: vi.fn(async (assetId: string) => {
        h.clearCalls.push(assetId);
      }),
      listByAssetIds: vi.fn(async () => h.tagRows),
      linkTags: vi.fn(async (assetId: string, tagIds: string[]) => {
        h.linkCalls.push({ assetId, tagIds });
      }),
    }),
  };
});

vi.mock("@oops/storage/s3", () => ({
  defaultS3Client: {},
  createStorage: () => ({
    removeObject: vi.fn(async (key: string) => {
      if (h.failRemoveObject) throw new Error("delete boom");
      h.removedObjectKey = key;
    }),
  }),
}));

import { DELETE, GET, PATCH } from "./route";

function patchReq(body: unknown): Request {
  return new Request("http://localhost/api/assets/a1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function delReq(): Request {
  return new Request("http://localhost/api/assets/a1", { method: "DELETE" });
}

function getReq(): Request {
  return new Request("http://localhost/api/assets/a1");
}

const ctx = { params: Promise.resolve({ id: "a1" }) };

describe("GET /api/assets/[id]", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.ownedRow = {
      id: "a1",
      title: "618主图",
      savedAt: new Date("2026-10-17T10:00:00Z"),
      storageKey: "assets/a.png",
      mimeType: "image/png",
      width: 1024,
      height: 768,
      kind: "image",
    };
    h.tagRows = [{ assetId: "a1", tagId: "t1", name: "海报" }];
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(401);
  });

  it("他人资产返回 404（不泄露存在性）", async () => {
    h.ownedRow = undefined;
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
  });

  it("返回可访问地址与元信息（画布转交设计据此换址）", async () => {
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(body.item).toMatchObject({
      id: "a1",
      url: "/files/assets/a.png",
      width: 1024,
      height: 768,
      title: "618主图",
      tags: [{ tagId: "t1", name: "海报" }],
    });
  });
});

describe("PATCH /api/assets/[id]", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.ownedRow = { id: "a1", title: null, savedAt: null };
    h.setSavedArgs = [];
    h.clearCalls = [];
    h.linkCalls = [];
    h.createdTags = [];
    h.txError = null;
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await PATCH(patchReq({ savedAt: new Date().toISOString() }), ctx);
    expect(res.status).toBe(401);
  });

  it("非本人资产返回 404（不泄露存在性）", async () => {
    h.ownedRow = undefined;
    const res = await PATCH(patchReq({ savedAt: new Date().toISOString() }), ctx);
    expect(res.status).toBe(404);
    expect(h.setSavedArgs).toHaveLength(0);
  });

  it("非法 JSON 返回 400", async () => {
    const res = await PATCH(patchReq("not-json"), ctx);
    expect(res.status).toBe(400);
  });

  it("空变更集返回 400", async () => {
    const res = await PATCH(patchReq({}), ctx);
    expect(res.status).toBe(400);
  });

  it("收藏：写入 savedAt 且不碰标题", async () => {
    const iso = new Date().toISOString();
    const res = await PATCH(patchReq({ savedAt: iso }), ctx);
    expect(res.status).toBe(200);
    expect(h.setSavedArgs[0]).toEqual({ savedAt: new Date(iso) });
  });

  it("取消收藏：savedAt 为 null", async () => {
    const res = await PATCH(patchReq({ savedAt: null }), ctx);
    expect(res.status).toBe(200);
    expect(h.setSavedArgs[0]).toEqual({ savedAt: null });
  });

  it("只改标题时 savedAt 键缺席（不得清空收藏态）", async () => {
    const res = await PATCH(patchReq({ title: "618主图" }), ctx);
    expect(res.status).toBe(200);
    expect(h.setSavedArgs[0]).toEqual({ title: "618主图" });
    expect("savedAt" in (h.setSavedArgs[0] as object)).toBe(false);
  });

  it("覆盖式标签：先清空再写入新集合", async () => {
    const res = await PATCH(patchReq({ tags: ["海报", "618"] }), ctx);
    expect(res.status).toBe(200);
    expect(h.createdTags).toEqual(["海报", "618"]);
    expect(h.clearCalls).toEqual(["a1"]);
    expect(h.linkCalls[0]).toEqual({ assetId: "a1", tagIds: ["t-海报", "t-618"] });
  });

  it("传空 tags 表示清空全部标签", async () => {
    const res = await PATCH(patchReq({ tags: [] }), ctx);
    expect(res.status).toBe(200);
    expect(h.clearCalls).toEqual(["a1"]);
    expect(h.linkCalls).toHaveLength(0);
  });

  it("不传 tags 则不触碰标签关联", async () => {
    await PATCH(patchReq({ title: "x" }), ctx);
    expect(h.clearCalls).toHaveLength(0);
    expect(h.linkCalls).toHaveLength(0);
  });

  it("事务失败返回 500", async () => {
    h.txError = new Error("db boom");
    const res = await PATCH(patchReq({ title: "x" }), ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("DELETE /api/assets/[id]", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.ownedKey = "assets/a.png";
    h.removedAssetId = null;
    h.removedObjectKey = null;
    h.failRemoveObject = false;
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(401);
  });

  it("非本人资产返回 404 且不删字节", async () => {
    h.ownedKey = undefined;
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(404);
    expect(h.removedObjectKey).toBeNull();
    expect(h.removedAssetId).toBeNull();
  });

  it("成功：先删字节再删行", async () => {
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(h.removedObjectKey).toBe("assets/a.png");
    expect(h.removedAssetId).toBe("a1");
  });

  it("字节删除失败：不删行，返回可重试错误", async () => {
    h.failRemoveObject = true;
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ASSET_DELETE_FAILED");
    // 行必须保留：行先删则字节删除失败时无法重试，会留永久孤儿对象
    expect(h.removedAssetId).toBeNull();
  });
});