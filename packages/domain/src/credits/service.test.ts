import { describe, expect, it, vi } from "vitest";
import { InsufficientCreditsError, type CreditLedgerRepo } from "@oops/db/credit-ledger.repo";
import type { TaskRepo } from "@oops/db/task.repo";
import { TaskError } from "../tasks/task-error";
import { createCreditsService, INITIAL_GRANT_CREDITS } from "./service";

function makeLedger(overrides: Partial<CreditLedgerRepo> = {}): CreditLedgerRepo {
  return {
    freeze: vi.fn().mockResolvedValue({ id: "e1" }),
    settle: vi.fn().mockResolvedValue(undefined),
    releaseByTask: vi.fn().mockResolvedValue(undefined),
    releaseEntry: vi.fn().mockResolvedValue(undefined),
    adjust: vi.fn().mockResolvedValue(undefined),
    getBalance: vi.fn().mockResolvedValue(5),
    getPrice: vi.fn().mockResolvedValue(10),
    listLeakedFrozen: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CreditLedgerRepo;
}

function makeTxRepos(overrides: {
  tasks?: Partial<TaskRepo>;
  ledger?: Partial<CreditLedgerRepo>;
} = {}) {
  return {
    tasks: { create: vi.fn().mockResolvedValue({ id: "t1", userId: "u1" }), ...overrides.tasks } as unknown as TaskRepo,
    ledger: makeLedger(overrides.ledger),
  };
}

/** 事务直通：脱离真实库，断言事务内调用序。 */
function passthroughDeps(txRepos: ReturnType<typeof makeTxRepos>) {
  return {
    runTx: <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
    makeTxRepos: () => txRepos,
  };
}

describe("credits service", () => {
  it("checkGate：余额 ≤ 0 拒绝，正数放行并返回余额", async () => {
    const zero = createCreditsService({
      ledger: makeLedger({ getBalance: vi.fn().mockResolvedValue(0) }),
    });
    await expect(zero.checkGate("u1")).resolves.toEqual({ ok: false, balance: 0 });
    const positive = createCreditsService({
      ledger: makeLedger({ getBalance: vi.fn().mockResolvedValue(5) }),
    });
    await expect(positive.checkGate("u1")).resolves.toEqual({ ok: true, balance: 5 });
  });

  it("grantInitialCredits 以 grant 流水发放固定额度", async () => {
    const ledger = makeLedger();
    await createCreditsService({ ledger }).grantInitialCredits("u1");
    expect(ledger.adjust).toHaveBeenCalledWith({
      userId: "u1",
      amount: INITIAL_GRANT_CREDITS,
      type: "grant",
      note: "registration",
    });
  });

  it("reconcileFrozen 逐条释放泄漏冻结并返回条数", async () => {
    const ledger = makeLedger({
      listLeakedFrozen: vi.fn().mockResolvedValue([
        { entryId: "e1", userId: "u1", amount: -10, taskId: null },
        { entryId: "e2", userId: "u2", amount: -5, taskId: "t9" },
      ]),
    });
    await expect(createCreditsService({ ledger }).reconcileFrozen()).resolves.toBe(2);
    expect(ledger.releaseEntry).toHaveBeenCalledWith("e1");
    expect(ledger.releaseEntry).toHaveBeenCalledWith("e2");
  });

  it("freezeForTask：未知类型 / 定价缺失 → TaskError pricing_missing", async () => {
    const noKey = createCreditsService({ ledger: makeLedger() });
    await expect(
      noKey.freezeForTask({ userId: "u1", type: "bogus", payload: {} }),
    ).rejects.toMatchObject({ kind: "pricing_missing" });
    const noPrice = createCreditsService({
      ledger: makeLedger({ getPrice: vi.fn().mockResolvedValue(null) }),
    });
    await expect(
      noPrice.freezeForTask({ userId: "u1", type: "generate_image", payload: {} }),
    ).rejects.toMatchObject({ kind: "pricing_missing" });
  });

  it("freezeForTask：余额不足映射为 TaskError insufficient_credits", async () => {
    const svc = createCreditsService({
      ledger: makeLedger(),
      ...passthroughDeps(
        makeTxRepos({ ledger: { freeze: vi.fn().mockRejectedValue(new InsufficientCreditsError()) } }),
      ),
    });
    await expect(
      svc.freezeForTask({ userId: "u1", type: "generate_image", payload: {} }),
    ).rejects.toBeInstanceOf(TaskError);
    await expect(
      svc.freezeForTask({ userId: "u1", type: "generate_image", payload: {} }),
    ).rejects.toMatchObject({ kind: "insufficient_credits" });
  });

  it("freezeForTask：成功路径在事务内创建任务并按定价冻结", async () => {
    const txRepos = makeTxRepos();
    const svc = createCreditsService({
      ledger: makeLedger({ getPrice: vi.fn().mockResolvedValue(10) }),
      ...passthroughDeps(txRepos),
    });
    await expect(
      svc.freezeForTask({ userId: "u1", type: "render_html", payload: { html: "<p/>" } }),
    ).resolves.toEqual({ taskId: "t1" });
    expect(txRepos.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", type: "render_html" }),
    );
    expect(txRepos.ledger.freeze).toHaveBeenCalledWith({ userId: "u1", taskId: "t1", price: 10 });
  });

  it("settle / release 透传到 ledger 仓储", async () => {
    const ledger = makeLedger();
    const svc = createCreditsService({ ledger });
    await svc.settle("t1", 8);
    await svc.release("t2");
    expect(ledger.settle).toHaveBeenCalledWith({ taskId: "t1", actualCost: 8 });
    expect(ledger.releaseByTask).toHaveBeenCalledWith({ taskId: "t2" });
  });
});
