import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import {
  createTagRepo,
  EmptyTagNameError,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_ASSET,
  normalizeTagName,
  TagLookupInvariantError,
  TagNameTooLongError,
  TooManyTagsError,
} from "./tag.repo";

describe("tag repo", () => {
  it("normalizeTagName trims but preserves case", () => {
    expect(normalizeTagName("  海报  ")).toBe("海报");
    expect(normalizeTagName("Poster")).toBe("Poster");
  });

  describe("findOrCreate", () => {
    it("inserts a new tag when the name is free", async () => {
      const mock = makeMockDb({ pendingValues: { name: "海报" } });
      const repo = createTagRepo(mock.db);
      const tag = await repo.findOrCreate("  海报  ");
      expect(tag).toMatchObject({ name: "海报" });
      expect(mock.state.calls.at(-1)?.op).toBe(
        "insert.values.onConflictDoNothing.returning",
      );
      expect(mock.state.lastValues).toMatchObject({ name: "海报" });
    });

    it("falls back to a lookup when the insert conflicts", async () => {
      const mock = makeMockDb({
        selectQueue: [[{ id: "t-existing", name: "海报" }]],
        conflictOnNextInsert: true,
      });
      const repo = createTagRepo(mock.db);
      const tag = await repo.findOrCreate("海报");
      expect(tag.id).toBe("t-existing");
      expect(mock.state.calls.some((c) => c.op === "select.from.where.limit")).toBe(true);
    });

    it("surfaces a classified invariant error when the conflicting row is gone", async () => {
      const mock = makeMockDb({ selectQueue: [[]], conflictOnNextInsert: true });
      const repo = createTagRepo(mock.db);
      // 错误须可分类：调用方据此区分"数据层异常"与普通失败。
      // message 不得含用户原始输入（防日志注入/无界拼接）。
      const err = await repo.findOrCreate("海报").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TagLookupInvariantError);
      expect((err as Error).message).not.toContain("海报");
    });

    it("rejects a blank name without touching the db", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      await expect(repo.findOrCreate("   ")).rejects.toBeInstanceOf(EmptyTagNameError);
      expect(mock.state.calls).toHaveLength(0);
    });

    it("rejects an over-long name before hitting the db", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      await expect(repo.findOrCreate("x".repeat(MAX_TAG_NAME_LENGTH + 1))).rejects.toBeInstanceOf(
        TagNameTooLongError,
      );
      expect(mock.state.calls).toHaveLength(0);
    });
  });

  describe("listByAssetIds", () => {
    it("short-circuits on empty ids", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      expect(await repo.listByAssetIds([])).toEqual([]);
      expect(mock.state.calls).toHaveLength(0);
    });

    it("projects to assetId/tagId/name, dropping other columns", async () => {
      // 注入多余列：若实现只是透传 rows，本断言会因多余字段而失败，
      // 因此它能证明投影确实发生（而非碰巧数据形状相同）。
      const mock = makeMockDb({
        selectResult: [
          { assetId: "a1", tagId: "t1", name: "海报", createdAt: new Date(0) },
          { assetId: "a1", tagId: "t2", name: "618", createdAt: new Date(0) },
          { assetId: "a2", tagId: "t1", name: "海报", createdAt: new Date(0) },
        ],
      });
      const repo = createTagRepo(mock.db);
      const rows = await repo.listByAssetIds(["a1", "a2"]);
      expect(rows).toEqual([
        { assetId: "a1", tagId: "t1", name: "海报" },
        { assetId: "a1", tagId: "t2", name: "618" },
        { assetId: "a2", tagId: "t1", name: "海报" },
      ]);
      expect(mock.state.calls.at(-1)?.op).toBe("select.from.innerJoin.where");
    });
  });

  describe("clearForAsset / linkTags", () => {
    it("clearForAsset deletes by assetId", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      await repo.clearForAsset("a1");
      expect(mock.state.calls.at(-1)?.op).toBe("delete.where");
    });

    it("linkTags writes deduplicated rows", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      await repo.linkTags("a1", ["t1", "t2", "t1"]);
      expect(mock.state.calls.at(-1)?.op).toBe("insert.values.onConflictDoNothing");
      expect(mock.state.lastValues).toEqual([
        { assetId: "a1", tagId: "t1" },
        { assetId: "a1", tagId: "t2" },
      ]);
    });

    it("linkTags with no ids does not touch the db", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      await repo.linkTags("a1", []);
      expect(mock.state.calls).toHaveLength(0);
    });

    it("linkTags rejects an over-count set", async () => {
      const mock = makeMockDb();
      const repo = createTagRepo(mock.db);
      const tooMany = Array.from(
        { length: MAX_TAGS_PER_ASSET + 1 },
        (_, i) => `t${i}`,
      );
      await expect(repo.linkTags("a1", tooMany)).rejects.toBeInstanceOf(TooManyTagsError);
      expect(mock.state.calls).toHaveLength(0);
    });
  });
});