import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 认证/仓储/存储，验证作品集列表的分页、标签筛选、批量收藏态与越权语义。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  savedRows: [] as unknown[],
  manyRows: [] as { id: string; userId: string }[],
  tagLinks: [] as { assetId: string; tagId: string; name: string }[],
  createdTagId: "t1",
  listArgs: [] as unknown[],
  tagError: null as Error | null,
}));

vi.mock("@oops/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));

vi.mock("@oops/db/asset.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oops/db/asset.repo")>();
  return {
    ...actual,
    createAssetRepo: () => ({
      listSaved: vi.fn(async (_userId: string, options?: unknown) => {
        h.listArgs.push(options);
        return h.savedRows;
      }),
      getManyByIds: vi.fn(async () => h.manyRows),
    }),
  };
});

vi.mock("@oops/db/tag.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oops/db/tag.repo")>();
  return {
    ...actual,
    createTagRepo: () => ({
      findOrCreate: vi.fn(async () => {
        if (h.tagError) throw h.tagError;
        return { id: h.createdTagId, name: "海报" };
      }),
      listByAssetIds: vi.fn(async () => h.tagLinks),
    }),
  };
});

import { GET } from "./route";

function req(query: string): Request {
  return new Request(`http://localhost/api/assets${query}`);
}

describe("GET /api/assets", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.savedRows = [];
    h.manyRows = [];
    h.tagLinks = [];
    h.createdTagId = "t1";
    h.listArgs = [];
    h.tagError = null;
  });

  it("未认证返回 401", async () => {
    h.userId = null;
    const res = await GET(req("?saved=true"));
    expect(res.status).toBe(401);
  });

  it("saved 参数缺失返回空列表（不列出全部资产）", async () => {
    const res = await GET(req(""));
    await expect(res.json()).resolves.toEqual({ items: [] });
  });

  it("返回作品集条目并带上标签与来源会话名", async () => {
    h.savedRows = [
      {
        id: "a1",
        storageKey: "assets/a.png",
        mimeType: "image/png",
        width: 1024,
        height: 768,
        kind: "image",
        title: "618主图",
        savedAt: new Date("2026-10-17T10:00:00Z"),
        sessionId: "s1",
        sessionTitle: "商品主图设计",
      },
    ];
    h.tagLinks = [{ assetId: "a1", tagId: "t1", name: "海报" }];
    const res = await GET(req("?saved=true"));
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "a1",
      url: "/files/assets/a.png",
      title: "618主图",
      sessionTitle: "商品主图设计",
      tags: [{ tagId: "t1", name: "海报" }],
    });
  });

  it("来源会话已被删除时 sessionTitle 为 null 而非丢行", async () => {
    h.savedRows = [{ id: "a1", storageKey: "k", sessionTitle: null }];
    const res = await GET(req("?saved=true"));
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.sessionTitle).toBeNull();
  });

  it("标签筛选：先find-or-create 拿 tagId 再传给 repo", async () => {
    await GET(req("?saved=true&tag=%E6%B5%B7%E6%8A%A5"));
    expect(h.listArgs[0]).toMatchObject({ tagId: "t1" });
  });

  it("标签名非法（findOrCreate 抛错）返回 400 且不查列表", async () => {
    h.tagError = new Error("blank");
    const res = await GET(req("?saved=true&tag=x"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID");
    expect(h.listArgs).toHaveLength(0);
  });

  it("非法游标返回 400", async () => {
    const res = await GET(req("?saved=true&cursor=%%%not-base64"));
    expect(res.status).toBe(400);
  });

  it("超限limit 被 zod 拒绝", async () => {
    const res = await GET(req("?saved=true&limit=9999"));
    expect(res.status).toBe(400);
    expect(h.listArgs).toHaveLength(0);
  });

  it("取满一页时返回 nextCursor，不足一页时为 null", async () => {
    const mk = (i: number) => ({
      id: `a${i}`,
      storageKey: `k${i}`,
      savedAt: new Date(`2026-10-17T10:00:0${i}Z`),
      sessionTitle: null,
    });
    h.savedRows = [mk(1), mk(2)];
    const full = (await (await GET(req("?saved=true&limit=2"))).json()) as {
      nextCursor: string | null;
    };
    expect(full.nextCursor).not.toBeNull();
    // 游标可回解：base64("<iso>|<id>")
    expect(Buffer.from(full.nextCursor!, "base64").toString("utf8")).toContain("|a2");

    h.savedRows = [mk(1)];
    const partial = (await (await GET(req("?saved=true&limit=2"))).json()) as {
      nextCursor: string | null;
    };
    expect(partial.nextCursor).toBeNull();
  });

  describe("批量收藏态（ids）", () => {
    it("返回每张图的收藏态，未命中的标为未收藏", async () => {
      h.manyRows = [{ id: "a1", userId: "u1" }];
      const res = await GET(req("?saved&ids=a1,a2,a3"));
      const body = (await res.json()) as { items: { id: string; saved: boolean }[] };
      expect(body.items).toEqual([
        { id: "a1", saved: true },
        { id: "a2", saved: false },
        { id: "a3", saved: false },
      ]);
    });

    it("他人资产一律按未收藏返回，不泄露存在性", async () => {
      h.manyRows = [{ id: "a1", userId: "other" }];
      const res = await GET(req("?saved&ids=a1"));
      const body = (await res.json()) as { items: { id: string; saved: boolean }[] };
      expect(body.items[0]?.saved).toBe(false);
    });

    it("空 ids 返回空数组且不触库", async () => {
      const res = await GET(req("?saved&ids=%20%2C%20"));
      await expect(res.json()).resolves.toEqual({ items: [] });
    });

    it("ids 模式忽略分页参数", async () => {
      h.manyRows = [];
      await GET(req("?saved&ids=a1&cursor=abc&limit=10"));
      expect(h.listArgs).toHaveLength(0);
    });
  });
});