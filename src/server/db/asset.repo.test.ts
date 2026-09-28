import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createAssetRepo } from "./asset.repo";

describe("asset repo", () => {
  it("create stores storageKey/mime and defaults kind=image", async () => {
    const mock = makeMockDb();
    const repo = createAssetRepo(mock.db);
    const row = await repo.create({ storageKey: "assets/x.png", mimeType: "image/png" });
    expect(row).toMatchObject({
      storageKey: "assets/x.png",
      kind: "image",
      userId: "owner",
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
});
