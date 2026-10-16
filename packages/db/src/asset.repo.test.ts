import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createAssetRepo } from "./asset.repo";

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
});
