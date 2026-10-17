import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import {
  createAssetRepo,
  DEFAULT_SAVED_PAGE_SIZE,
  MAX_SAVED_PAGE_SIZE,
} from "./asset.repo";

describe("asset repo", () => {
  it("create stores storageKey/mime and defaults kind=image", async () => {
    const mock = makeMockDb();
    const repo = createAssetRepo(mock.db);
    const row = await repo.create({ storageKey: "assets/x.png", mimeType: "image/png", userId: "u1" });
    expect(row).toMatchObject({
      storageKey: "assets/x.png",
      kind: "image",
      userId: "u1",
    });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("get returns first matching row", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "a1" }] });
    const repo = createAssetRepo(mock.db);
    const row = await repo.get("a1");
    expect(row?.id).toBe("a1");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
  });

  it("getManyByIds batches by inArray and short-circuits on empty ids", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "a1" }, { id: "a2" }] });
    const repo = createAssetRepo(mock.db);
    expect(await repo.getManyByIds([])).toEqual([]);
    expect(mock.state.calls).toHaveLength(0); // 空列表不触库
    const rows = await repo.getManyByIds(["a1", "a2"]);
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where");
  });

  it("list without sessionId yields a select with limit", async () => {
    const mock = makeMockDb({ selectResult: [] });
    const repo = createAssetRepo(mock.db);
    const rows = await repo.list();
    expect(rows).toEqual([]);
    expect(mock.state.calls.at(-1)?.op).toContain("select.from");
    expect(mock.state.calls.at(-1)?.op).toContain("limit");
  });

  it("remove deletes by id", async () => {
    const mock = makeMockDb();
    const repo = createAssetRepo(mock.db);
    await repo.remove("a1");
    expect(mock.state.calls.at(-1)?.op).toContain("delete.where");
  });

  it("listKeysBySession returns all keys without row limit", async () => {
    const mock = makeMockDb({
      selectResult: [{ storageKey: "assets/a.png" }, { storageKey: "assets/b.jpg" }],
    });
    const repo = createAssetRepo(mock.db);
    const keys = await repo.listKeysBySession("s1");
    expect(keys).toEqual(["assets/a.png", "assets/b.jpg"]);
    const last = mock.state.calls.at(-1);
    expect(last?.op).toBe("select.from.where");
    expect(last?.op).not.toContain("limit");
  });

  it("removeBySession deletes rows by sessionId", async () => {
    const mock = makeMockDb();
    const repo = createAssetRepo(mock.db);
    await repo.removeBySession("s1");
    expect(mock.state.calls.at(-1)?.op).toBe("delete.where");
  });

  describe("portfolio", () => {
    const savedRow = (over: Record<string, unknown> = {}) => ({
      asset: {
        id: "a1",
        userId: "u1",
        storageKey: "assets/a.png",
        savedAt: new Date("2026-10-17T10:00:00Z"),
        title: null,
        ...over,
      },
      sessionTitle: "商品主图设计",
    });

    it("listSaved returns assets joined with the source session title", async () => {
      const mock = makeMockDb({ selectResult: [savedRow()] });
      const repo = createAssetRepo(mock.db);
      const items = await repo.listSaved("u1");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: "a1", sessionTitle: "商品主图设计" });
      expect(mock.state.calls.at(-1)?.op).toBe(
        "select.from.leftJoin.where.orderBy.limit",
      );
    });

    it("listSaved maps a missing session to a null title", async () => {
      // 会话被删后 sessionId 已置空，leftJoin 必须给出 null 而非丢掉整行
      const mock = makeMockDb({ selectResult: [{ asset: savedRow().asset, sessionTitle: null }] });
      const repo = createAssetRepo(mock.db);
      const items = await repo.listSaved("u1");
      expect(items[0]?.sessionTitle).toBeNull();
      expect(items[0]?.id).toBe("a1");
    });

    it("listSaved applies a composite cursor for stable paging", async () => {
      const mock = makeMockDb({ selectResult: [] });
      const repo = createAssetRepo(mock.db);
      await repo.listSaved("u1", {
        cursor: { savedAt: new Date("2026-10-17T10:00:00Z"), id: "a1" },
      });
      // 游标条件进入 where（复合不等式），且排序按 savedAt desc, id desc
      expect(mock.state.calls.at(-1)?.op).toBe(
        "select.from.leftJoin.where.orderBy.limit",
      );
    });

    it("listSaved clamps the page size", async () => {
      const mock = makeMockDb({ selectResult: [] });
      const repo = createAssetRepo(mock.db);
      await repo.listSaved("u1", { limit: 9999 });
      const limitCall = mock.state.calls.find((c) => c.op.endsWith(".limit"));
      expect(limitCall?.args[0]).toBe(MAX_SAVED_PAGE_SIZE);
    });

    it("listSaved uses a default page size when none is given", async () => {
      const mock = makeMockDb({ selectResult: [] });
      const repo = createAssetRepo(mock.db);
      await repo.listSaved("u1");
      const limitCall = mock.state.calls.find((c) => c.op.endsWith(".limit"));
      expect(limitCall?.args[0]).toBe(DEFAULT_SAVED_PAGE_SIZE);
    });

    it("getSaved returns undefined for an asset owned by someone else", async () => {
      const mock = makeMockDb({ selectResult: [] });
      const repo = createAssetRepo(mock.db);
      expect(await repo.getSaved("a1", "other-user")).toBeUndefined();
      // 必须带 userId 过滤：单条 eq(id) 不足以防越权
      expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
    });

    it("setSaved scopes the update to the owner and is idempotent", async () => {
      const mock = makeMockDb({ pendingSet: { savedAt: new Date(), title: "主图" } });
      const repo = createAssetRepo(mock.db);
      const row = await repo.setSaved("a1", "u1", {
        savedAt: new Date(),
        title: "主图",
      });
      expect(row).toMatchObject({ title: "主图" });
      expect(mock.state.lastSet).toMatchObject({ savedAt: expect.any(Date), title: "主图" });
    });

    it("setSaved leaves the title untouched when it is not provided", async () => {
      const mock = makeMockDb({ pendingSet: { savedAt: null } });
      const repo = createAssetRepo(mock.db);
      await repo.setSaved("a1", "u1", { savedAt: null });
      // 不带 title 键：否则会把用户已命名的作品清空
      expect(mock.state.lastSet).toEqual({ savedAt: null });
    });

    it("getOwnedKey returns the key only for the owner", async () => {
      const mock = makeMockDb({ selectResult: [{ storageKey: "assets/a.png" }] });
      const repo = createAssetRepo(mock.db);
      expect(await repo.getOwnedKey("a1", "u1")).toBe("assets/a.png");
      expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
    });

    it("listKeysBySessionUnsaved excludes saved assets", async () => {
      const mock = makeMockDb({ selectResult: [{ storageKey: "assets/b.png" }] });
      const repo = createAssetRepo(mock.db);
      const keys = await repo.listKeysBySessionUnsaved("s1");
      expect(keys).toEqual(["assets/b.png"]);
      expect(mock.state.calls.at(-1)?.op).toBe("select.from.where");
      // 与 listKeysBySession 同为无上限列举
      expect(mock.state.calls.at(-1)?.op).not.toContain("limit");
    });

    it("removeUnsavedBySession deletes only unsaved rows", async () => {
      const mock = makeMockDb();
      const repo = createAssetRepo(mock.db);
      await repo.removeUnsavedBySession("s1");
      expect(mock.state.calls.at(-1)?.op).toBe("delete.where");
    });

    it("existing session-scoped methods are unchanged", async () => {
      // 回归护栏：新增 Unsaved 变体不得改变原方法语义
      const mock = makeMockDb({ selectResult: [] });
      const repo = createAssetRepo(mock.db);
      await repo.listKeysBySession("s1");
      expect(mock.state.calls.at(-1)?.op).toBe("select.from.where");
      expect(mock.state.calls.at(-1)?.args[0]).toBeUndefined();
    });
  });
});
