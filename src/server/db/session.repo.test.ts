import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createSessionRepo } from "./session.repo";

describe("session repo", () => {
  it("create persists explicit userId and returns the row", async () => {
    const mock = makeMockDb();
    const repo = createSessionRepo(mock.db);
    const row = await repo.create({ title: "我的会话", userId: "u1" });
    expect(row).toMatchObject({ title: "我的会话", userId: "u1" });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("list applies userId filter and ordering", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "s1" }] });
    const repo = createSessionRepo(mock.db);
    const rows = await repo.list("u1");
    expect(rows).toHaveLength(1);
    expect(mock.state.calls.at(-1)?.op).toContain("limit");
  });

  it("get scopes by id + userId", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "s1", userId: "u1" }] });
    const repo = createSessionRepo(mock.db);
    const row = await repo.get("s1", "u1");
    expect(row?.id).toBe("s1");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
  });

  it("rename returns updated title", async () => {
    const mock = makeMockDb();
    const repo = createSessionRepo(mock.db);
    const row = await repo.rename("s1", "新标题");
    expect(row).toMatchObject({ title: "新标题" });
    expect(mock.state.calls.at(-1)?.op).toBe("update.set.where.returning");
  });

  it("updateSummary persists summary and watermark", async () => {
    const mock = makeMockDb();
    const repo = createSessionRepo(mock.db);
    const row = await repo.updateSummary("s1", {
      summary: "用户要做海边海报",
      summarizedUpTo: "m1",
    });
    expect(row).toMatchObject({ summary: "用户要做海边海报", summarizedUpTo: "m1" });
    expect(mock.state.calls.at(-1)?.op).toBe("update.set.where.returning");
  });

  it("updateSummary accepts null watermark to reset", async () => {
    const mock = makeMockDb();
    const repo = createSessionRepo(mock.db);
    const row = await repo.updateSummary("s1", { summary: "重算占位", summarizedUpTo: null });
    expect(row).toMatchObject({ summarizedUpTo: null });
  });

  it("remove issues delete with id filter", async () => {
    const mock = makeMockDb();
    const repo = createSessionRepo(mock.db);
    await repo.remove("s1");
    expect(mock.state.calls.at(-1)?.op).toContain("delete.where");
  });
});
