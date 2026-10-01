import { describe, expect, it, vi, type Mock } from "vitest";
import { registerUser } from "./register";
import type { DbClient } from "@/server/db/invite-code.repo";

// 事务 stub：db.transaction(fn) 直接以链式 stub 调用 fn；Proxy mock 无法驱动事务流
function makeTxStub(
  opts: { returningResults?: unknown[][]; limitResults?: unknown[][] } = {},
) {
  const captured: {
    whereArgs: unknown[][];
    valuesArgs: Array<Record<string, unknown>>;
  } = {
    whereArgs: [],
    valuesArgs: [],
  };
  let returningIdx = 0;
  let limitIdx = 0;
  const chain: Record<string, Mock> = {};
  for (const name of [
    "select",
    "from",
    "where",
    "update",
    "set",
    "insert",
    "values",
  ] as const) {
    chain[name] = vi.fn((...args: unknown[]) => {
      if (name === "where") captured.whereArgs.push(args);
      if (name === "values") {
        captured.valuesArgs.push(args[0] as Record<string, unknown>);
      }
      return chain;
    });
  }
  chain.returning = vi.fn(() =>
    Promise.resolve(opts.returningResults?.[returningIdx++] ?? []),
  );
  chain.limit = vi.fn(() =>
    Promise.resolve(opts.limitResults?.[limitIdx++] ?? []),
  );
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(chain),
  );
  const db = { transaction } as unknown as DbClient;
  return { db, chain, transaction, captured };
}

const code = {
  id: "c1",
  code: "CODE-1",
  maxUses: 1,
  usedCount: 0,
  expiresAt: null,
  note: null,
  createdAt: new Date(),
};

const input = {
  username: "alice",
  passwordHash: "HASH",
  inviteCode: "CODE-1",
};

describe("registerUser", () => {
  it("consumes the code and creates the user in one transaction", async () => {
    const { db, transaction, captured } = makeTxStub({
      returningResults: [[code], [{ id: "u1", username: "alice" }]],
      limitResults: [[]],
    });
    const result = await registerUser(input, db);
    expect(result).toEqual({ ok: true, user: { id: "u1", username: "alice" } });
    expect(transaction).toHaveBeenCalledOnce();
    expect(captured.valuesArgs[0]).toMatchObject({
      username: "alice",
      passwordHash: "HASH",
      inviteCodeId: "c1",
    });
  });

  it("rejects with invite_code_invalid and creates nothing when the code does not match", async () => {
    const { db, chain } = makeTxStub({ returningResults: [[]] });
    const result = await registerUser(input, db);
    expect(result).toEqual({ ok: false, reason: "invite_code_invalid" });
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("rejects with username_taken and leaves no writes when the name is taken after consuming", async () => {
    const { db, chain } = makeTxStub({
      returningResults: [[code]],
      limitResults: [[{ id: "u0" }]],
    });
    const result = await registerUser(input, db);
    expect(result).toEqual({ ok: false, reason: "username_taken" });
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("generates an oops id in-transaction and retries once on oops-id conflict", async () => {
    const { db, captured } = makeTxStub({
      returningResults: [[code], [{ id: "u1", username: "alice" }]],
      // findByUsername 空 → oopsId 第一次冲突 → 第二次可用
      limitResults: [[], [{ id: "x0" }], []],
    });
    const result = await registerUser(input, db);
    expect(result).toEqual({ ok: true, user: { id: "u1", username: "alice" } });
    expect(captured.valuesArgs[0]?.oopsId).toMatch(
      /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/,
    );
  });

  it("maps a unique violation from concurrent same-name registration to username_taken", async () => {
    const { db, chain } = makeTxStub({
      returningResults: [[code]],
      limitResults: [[]],
    });
    (chain.returning as Mock).mockRejectedValueOnce({ code: "23505" });
    const result = await registerUser(input, db);
    expect(result).toEqual({ ok: false, reason: "username_taken" });
  });

  it("rethrows unexpected errors", async () => {
    const { db, chain } = makeTxStub({
      returningResults: [[code]],
      limitResults: [[]],
    });
    (chain.returning as Mock).mockRejectedValueOnce(new Error("boom"));
    await expect(registerUser(input, db)).rejects.toThrowError("boom");
  });
});
