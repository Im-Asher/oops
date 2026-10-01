import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createUserRepo } from "./user.repo";

describe("user repo", () => {
  it("findById filters by id", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "u1", username: "alice" }] });
    const row = await createUserRepo(mock.db).findById("u1");
    expect(row).toMatchObject({ id: "u1" });
    expect(mock.state.calls.at(-1)?.op).toContain("limit");
  });

  it("findByUsername issues a single lower() comparison query", async () => {
    const mock = makeMockDb({ selectResult: [] });
    await createUserRepo(mock.db).findByUsername("Alice");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
  });

  it("create inserts all fields and returns the row", async () => {
    const mock = makeMockDb();
    const row = await createUserRepo(mock.db).create({
      username: "alice",
      passwordHash: "HASH",
      inviteCodeId: "c1",
    });
    expect(row).toMatchObject({
      username: "alice",
      passwordHash: "HASH",
      inviteCodeId: "c1",
    });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });
});
