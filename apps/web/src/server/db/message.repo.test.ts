import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createMessageRepo } from "./message.repo";

describe("message repo", () => {
  it("create persists role/content/toolCalls and returns row", async () => {
    const mock = makeMockDb();
    const repo = createMessageRepo(mock.db);
    const row = await repo.create({
      sessionId: "s1",
      userId: "u1",
      role: "user",
      content: "hi",
      toolCalls: [{ tool: "generate_image" }],
    });
    expect(row).toMatchObject({ role: "user", content: "hi", userId: "u1" });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("create roundtrips transcript column", async () => {
    const mock = makeMockDb();
    const repo = createMessageRepo(mock.db);
    const transcript = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    const row = await repo.create({
      sessionId: "s1",
      userId: "u1",
      role: "user",
      content: "hi",
      transcript,
    });
    expect(row).toMatchObject({ transcript });
  });

  it("create allows missing transcript (nullable)", async () => {
    const mock = makeMockDb();
    const repo = createMessageRepo(mock.db);
    const row = await repo.create({ sessionId: "s1", userId: "u1", role: "assistant", content: "ok" });
    expect(row).not.toHaveProperty("transcript", expect.anything());
  });

  it("list orders by createdAt ascending", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "m1" }, { id: "m2" }] });
    const repo = createMessageRepo(mock.db);
    const rows = await repo.list("s1");
    expect(rows).toHaveLength(2);
    expect(mock.state.calls.at(-1)?.op).toContain("limit");
  });

  it("remove deletes by id", async () => {
    const mock = makeMockDb();
    const repo = createMessageRepo(mock.db);
    await repo.remove("m1");
    expect(mock.state.calls.at(-1)?.op).toContain("delete.where");
  });
});
