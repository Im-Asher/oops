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

  it("findByOopsId filters by the exact oops id", async () => {
    const mock = makeMockDb({ selectResult: [] });
    await createUserRepo(mock.db).findByOopsId("x7k9m2p4");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
  });

  it("create inserts all fields including oopsId and returns the row", async () => {
    const mock = makeMockDb();
    const row = await createUserRepo(mock.db).create({
      username: "alice",
      oopsId: "x7k9m2p4",
      passwordHash: "HASH",
      displayName: "小明",
      inviteCodeId: "c1",
    });
    expect(row).toMatchObject({
      username: "alice",
      oopsId: "x7k9m2p4",
      passwordHash: "HASH",
      displayName: "小明",
      inviteCodeId: "c1",
    });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("updateProfile applies only the provided fields", async () => {
    const mock = makeMockDb();
    await createUserRepo(mock.db).updateProfile("u1", {
      displayName: null,
      bio: "做电商图的",
    });
    expect(mock.state.lastSet).toEqual({
      displayName: null,
      bio: "做电商图的",
    });
    expect(mock.state.calls.at(-1)?.op).toBe("update.set.where.returning");
  });

  it("updateProfile clears fields with explicit null", async () => {
    const mock = makeMockDb();
    await createUserRepo(mock.db).updateProfile("u1", { bio: null });
    expect(mock.state.lastSet).toEqual({ bio: null });
  });

  it("updatePassword writes the hash and bumps token_version in one statement", async () => {
    const mock = makeMockDb();
    await createUserRepo(mock.db).updatePassword("u1", "NEW_HASH");
    const set = mock.state.lastSet as Record<string, unknown>;
    expect(set.passwordHash).toBe("NEW_HASH");
    // tokenVersion 以 sql 片段下发，由数据库端原位 +1
    expect(typeof set.tokenVersion).toBe("object");
    expect(mock.state.calls.at(-1)?.op).toBe("update.set.where.returning");
  });
});
