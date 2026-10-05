import { describe, expect, it, vi, type Mock } from "vitest";
import { makeMockDb } from "./mock-db";
import { createInviteCodeRepo, type DbClient } from "./invite-code.repo";

const codeRow = {
  id: "c1",
  code: "TEST-CODE",
  maxUses: 1,
  usedCount: 1,
  expiresAt: null,
  note: null,
  createdAt: new Date(),
};

// Proxy mock 无法表达"0 行命中"与 where/set 参数检查，条件扣减用可控链式 stub
function makeChainStub(returningResults: unknown[][] = []) {
  const captured: { whereArgs: unknown[][]; setArgs: unknown[] } = {
    whereArgs: [],
    setArgs: [],
  };
  let idx = 0;
  const chain: Record<string, Mock> = {};
  for (const name of ["select", "from", "where", "update", "set"] as const) {
    chain[name] = vi.fn((...args: unknown[]) => {
      if (name === "where") captured.whereArgs.push(args);
      if (name === "set") captured.setArgs.push(args[0]);
      return chain;
    });
  }
  chain.returning = vi.fn(() => Promise.resolve(returningResults[idx++] ?? []));
  return { db: chain as unknown as DbClient, chain, captured };
}

describe("invite-code repo", () => {
  it("findByCode filters by code and returns the row", async () => {
    const mock = makeMockDb({ selectResult: [codeRow] });
    const row = await createInviteCodeRepo(mock.db).findByCode("TEST-CODE");
    expect(row).toMatchObject({ id: "c1" });
    expect(mock.state.calls.at(-1)?.op).toContain("limit");
  });

  it("consumeByCode issues a single conditional UPDATE ... RETURNING", async () => {
    const { db, chain, captured } = makeChainStub([[codeRow]]);
    const row = await createInviteCodeRepo(db).consumeByCode("TEST-CODE");
    expect(row).toMatchObject({ id: "c1" });
    expect(chain.update).toHaveBeenCalledOnce();
    expect(captured.setArgs[0]).toHaveProperty("usedCount");
    expect(captured.whereArgs).toHaveLength(1);
  });

  it("consumeByCode returns undefined when no row matches (invalid/exhausted/expired)", async () => {
    const { db } = makeChainStub([[]]);
    const row = await createInviteCodeRepo(db).consumeByCode("BAD-CODE");
    expect(row).toBeUndefined();
  });
});
