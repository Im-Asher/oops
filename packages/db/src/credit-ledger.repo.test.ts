import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createCreditLedgerRepo } from "./credit-ledger.repo";

describe("credit-ledger repo（M2 task 5.2 扩展）", () => {
  it("listLedger counts first then pages in createdAt desc order", async () => {
    const mock = makeMockDb({
      selectQueue: [[{ count: 12 }], [{ id: "l1" }]],
    });
    const page = await createCreditLedgerRepo(mock.db).listLedger({
      userId: "u1",
      type: "adjust",
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-10-12T00:00:00Z"),
      page: 2,
      pageSize: 10,
    });
    expect(page).toMatchObject({ total: 12, page: 2, pageSize: 10 });
    expect(mock.state.calls[0]?.op).toBe("select.from.where");
    expect(mock.state.calls.at(-1)?.op).toBe(
      "select.from.where.orderBy.limit.offset",
    );
  });

  it("listLedger without filters issues a bare count query", async () => {
    const mock = makeMockDb({
      selectQueue: [[{ count: 3 }], [{ id: "l1" }]],
    });
    const page = await createCreditLedgerRepo(mock.db).listLedger({
      page: 1,
      pageSize: 20,
    });
    expect(page.total).toBe(3);
    expect(mock.state.calls[0]?.op).toBe("select.from");
  });

  it("listPrices returns all rows ordered by key", async () => {
    const mock = makeMockDb({
      selectResult: [{ key: "generate_image", credits: 10 }],
    });
    const rows = await createCreditLedgerRepo(mock.db).listPrices();
    expect(rows[0]).toMatchObject({ key: "generate_image", credits: 10 });
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.orderBy");
  });

  it("setPrice upserts and returns the row", async () => {
    const mock = makeMockDb({
      pendingValues: { key: "render_html", credits: 5 },
    });
    const row = await createCreditLedgerRepo(mock.db).setPrice("render_html", 5);
    expect(row).toMatchObject({ key: "render_html", credits: 5 });
    expect(mock.state.lastValues).toMatchObject({ key: "render_html", credits: 5 });
    expect(mock.state.calls.at(-1)?.op).toContain("onConflict");
  });

  it("reconcileBalances matches users against per-user ledger sums", async () => {
    const mock = makeMockDb({
      selectQueue: [
        // 第一条：全量用户；第二条：按 user 聚合流水
        [
          { id: "u1", username: "alice", balance: 100 },
          { id: "u2", username: "bob", balance: 30 },
          { id: "u3", username: "carol", balance: 0 },
        ],
        [
          { userId: "u1", sum: 100 },
          { userId: "u2", sum: 25 },
        ],
      ],
    });
    const mismatches = await createCreditLedgerRepo(mock.db).reconcileBalances();
    // u1 一致；u2 余额 30 ≠ 流水 25；u3 无流水但余额 0 → 一致（Σ=0）
    expect(mismatches).toEqual([
      { userId: "u2", username: "bob", balance: 30, ledgerSum: 25 },
    ]);
    expect(mock.state.calls[0]?.op).toBe("select.from");
    expect(mock.state.calls[1]?.op).toBe("select.from.groupBy");
  });
});
