import { describe, expect, it, vi, type Mock } from "vitest";
import { makeMockDb } from "./mock-db";
import {
  createInviteCodeRepo,
  deriveInviteStatus,
  generateInviteCode,
  INVITE_CODE_LENGTH,
  type DbClient,
} from "./invite-code.repo";

const codeRow = {
  id: "c1",
  code: "TEST-CODE",
  maxUses: 1,
  usedCount: 1,
  expiresAt: null,
  revokedAt: null,
  note: null,
  createdAt: new Date(),
};

// Proxy mock 无法表达"0 行命中"与 where/set/values 参数检查，条件语句用可控链式 stub
function makeChainStub(returningResults: unknown[][] = []) {
  const captured: {
    whereArgs: unknown[][];
    setArgs: unknown[];
    valuesArgs: unknown[];
  } = { whereArgs: [], setArgs: [], valuesArgs: [] };
  let idx = 0;
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
      if (name === "set") captured.setArgs.push(args[0]);
      if (name === "values") captured.valuesArgs.push(args[0]);
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

  it("findById filters by id", async () => {
    const mock = makeMockDb({ selectResult: [codeRow] });
    const row = await createInviteCodeRepo(mock.db).findById("c1");
    expect(row).toMatchObject({ id: "c1" });
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.limit");
  });

  it("consumeByCode issues a single conditional UPDATE ... RETURNING", async () => {
    const { db, chain, captured } = makeChainStub([[codeRow]]);
    const row = await createInviteCodeRepo(db).consumeByCode("TEST-CODE");
    expect(row).toMatchObject({ id: "c1" });
    expect(chain.update).toHaveBeenCalledOnce();
    expect(captured.setArgs[0]).toHaveProperty("usedCount");
    expect(captured.whereArgs).toHaveLength(1);
  });

  it("consumeByCode returns undefined when no row matches (invalid/revoked/exhausted/expired)", async () => {
    const { db } = makeChainStub([[]]);
    const row = await createInviteCodeRepo(db).consumeByCode("BAD-CODE");
    expect(row).toBeUndefined();
  });

  it("generateBatch inserts count rows with defaults and distinct codes", async () => {
    const inserted = [
      { id: "c1", code: "aaaaaaaa" },
      { id: "c2", code: "bbbbbbbb" },
      { id: "c3", code: "cccccccc" },
    ];
    const { db, chain, captured } = makeChainStub([inserted]);
    let seq = 0;
    const factory = () => ["aaaaaaaa", "aaaaaaaa", "bbbbbbbb", "cccccccc"][seq++];
    const rows = await createInviteCodeRepo(db).generateBatch(
      { count: 3, note: "M2 冒烟" },
      factory,
    );
    expect(rows).toHaveLength(3);
    expect(chain.insert).toHaveBeenCalledOnce();
    // factory 产出的重复码（第 2 个 aaaaaaaa）被批内去重，不进 insert
    const values = captured.valuesArgs[0] as Record<string, unknown>[];
    expect(values.map((v) => v.code)).toEqual([
      "aaaaaaaa",
      "bbbbbbbb",
      "cccccccc",
    ]);
    // 缺省纪律：一次性码（maxUses=1）、永久有效（expiresAt=null）
    expect(values[0]).toMatchObject({ maxUses: 1, expiresAt: null, note: "M2 冒烟" });
  });

  it("generateBatch clamps count into 1..100", async () => {
    const { db, captured } = makeChainStub([[{ id: "c1" }]]);
    await createInviteCodeRepo(db).generateBatch({ count: 500 });
    expect(captured.valuesArgs[0]).toHaveLength(100);
  });

  it("revoke writes only revokedAt (expiresAt/usedCount untouched)", async () => {
    const { db, chain, captured } = makeChainStub([[codeRow]]);
    const row = await createInviteCodeRepo(db).revoke("c1");
    expect(row).toMatchObject({ id: "c1" });
    expect(chain.update).toHaveBeenCalledOnce();
    const set = captured.setArgs[0] as Record<string, unknown>;
    expect(Object.keys(set)).toEqual(["revokedAt"]);
    expect(set.revokedAt).toBeInstanceOf(Date);
  });

  it("revoke returns undefined when already revoked or missing (idempotent)", async () => {
    const { db } = makeChainStub([[]]);
    const row = await createInviteCodeRepo(db).revoke("c1");
    expect(row).toBeUndefined();
  });

  it("listForAdmin counts first then pages in createdAt desc order", async () => {
    const mock = makeMockDb({
      selectResult: [{ count: 2 }, { ...codeRow }, { ...codeRow, id: "c2" }],
    });
    const page = await createInviteCodeRepo(mock.db).listForAdmin({
      page: 2,
      pageSize: 5,
    });
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 5 });
    expect(mock.state.calls[0]?.op).toBe("select.from");
    expect(mock.state.calls.at(-1)?.op).toBe(
      "select.from.orderBy.limit.offset",
    );
  });
});

describe("deriveInviteStatus", () => {
  const base = { ...codeRow, usedCount: 0, maxUses: 2 };
  const now = new Date("2026-10-12T00:00:00.000Z");

  it("active: not revoked, not expired, uses remaining", () => {
    expect(
      deriveInviteStatus({ ...base, revokedAt: null, expiresAt: null }, now),
    ).toBe("active");
  });

  it("revoked wins over exhausted/expired (revoke preserves original semantics)", () => {
    expect(
      deriveInviteStatus(
        {
          ...base,
          usedCount: 2,
          expiresAt: new Date("2026-01-01T00:00:00.000Z"),
          revokedAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("revoked");
  });

  it("expired when expiresAt <= now even with uses remaining", () => {
    expect(
      deriveInviteStatus(
        { ...base, expiresAt: new Date("2026-10-12T00:00:00.000Z") },
        now,
      ),
    ).toBe("expired");
  });

  it("exhausted when usedCount >= maxUses", () => {
    expect(deriveInviteStatus({ ...base, usedCount: 2 }, now)).toBe("exhausted");
  });
});

describe("generateInviteCode", () => {
  it("produces 8-char codes over the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    }
  });

  it("alphabet length constant matches INVITE_CODE_LENGTH usage", () => {
    expect(INVITE_CODE_LENGTH).toBe(8);
  });
});
