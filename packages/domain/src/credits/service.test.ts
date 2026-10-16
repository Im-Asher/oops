import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsufficientCreditsError, type CreditLedgerRepo } from "@oops/db/credit-ledger.repo";
import type { TaskRepo } from "@oops/db/task.repo";
import { TaskError } from "../tasks/task-error";
import { createCreditsService, INITIAL_GRANT_CREDITS } from "./service";

// withAudit mock：直通执行 bizFn 并捕获审计输入，供 adjustCredits 用例断言
const { capturedAuditInputs } = vi.hoisted(() => ({
  capturedAuditInputs: [] as unknown[],
}));
vi.mock("@oops/db/admin-audit.repo", () => ({
  withAudit: vi.fn(async (
    runTx: (fn: () => Promise<unknown>) => Promise<unknown>,
    input: unknown,
    bizFn: () => Promise<unknown>,
  ) => {
    const result = await runTx(bizFn);
    capturedAuditInputs.push(
      typeof input === "function" ? (input as (r: unknown) => unknown)(result) : input,
    );
    return result;
  }),
}));

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
    listLedger: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    listPrices: vi.fn().mockResolvedValue([]),
    setPrice: vi.fn().mockResolvedValue({ key: "k", credits: 0 }),
    reconcileBalances: vi.fn().mockResolvedValue([]),
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

beforeEach(() => {
  capturedAuditInputs.length = 0;
});

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

  describe("adjustCredits（M2 task 5.1）", () => {
    it("发放（正 delta）：adjust 流水 + 审计含前后余额", async () => {
      const txLedger = makeLedger({
        getBalance: vi.fn().mockResolvedValue(100),
        adjust: vi.fn().mockResolvedValue(150),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await expect(
        svc.adjustCredits({ userId: "u1", delta: 50, note: "运营发放", adminId: "admin-op" }),
      ).resolves.toEqual({ balance: 150 });
      expect(txLedger.adjust).toHaveBeenCalledWith({
        userId: "u1",
        amount: 50,
        type: "adjust",
        note: "运营发放",
      });
      expect(capturedAuditInputs).toEqual([
        {
          adminUserId: "admin-op",
          action: "credits.adjust",
          targetType: "user",
          targetId: "u1",
          before: { balance: 100 },
          after: { balance: 150, delta: 50 },
          note: "运营发放",
        },
      ]);
    });

    it("扣减（负 delta）成功：流水为负、审计 delta 为负", async () => {
      const txLedger = makeLedger({
        getBalance: vi.fn().mockResolvedValue(100),
        adjust: vi.fn().mockResolvedValue(20),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await expect(
        svc.adjustCredits({ userId: "u1", delta: -80, note: "误发回收", adminId: "admin-op" }),
      ).resolves.toEqual({ balance: 20 });
      expect(txLedger.adjust).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -80 }),
      );
      expect(capturedAuditInputs[0]).toMatchObject({
        action: "credits.adjust",
        before: { balance: 100 },
        after: { balance: 20, delta: -80 },
      });
    });

    it("超额扣减：InsufficientCreditsError 冒泡，事务回滚无审计", async () => {
      const txLedger = makeLedger({
        getBalance: vi.fn().mockResolvedValue(50),
        adjust: vi.fn().mockRejectedValue(new InsufficientCreditsError()),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await expect(
        svc.adjustCredits({ userId: "u1", delta: -80, note: "超额", adminId: "admin-op" }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(capturedAuditInputs).toEqual([]); // bizFn 抛错：withAudit 未落审计
    });

    it("delta=0 / 非整数：直接拒绝，不触库不落审计", async () => {
      const txLedger = makeLedger();
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await expect(
        svc.adjustCredits({ userId: "u1", delta: 0, note: "x", adminId: "a" }),
      ).rejects.toMatchObject({ kind: "adjust_amount_invalid" });
      await expect(
        svc.adjustCredits({ userId: "u1", delta: 10.5, note: "x", adminId: "a" }),
      ).rejects.toMatchObject({ kind: "adjust_amount_invalid" });
      expect(txLedger.adjust).not.toHaveBeenCalled();
      expect(capturedAuditInputs).toEqual([]);
    });

    it("流水恒等式口径：余额变化 == adjust 流水 amount（事务内 before/after 与流水一致）", async () => {
      // mock 层校验调用口径：getBalance(before) → adjust 返回 after；差值 == delta == 流水金额
      const txLedger = makeLedger({
        getBalance: vi.fn().mockResolvedValue(40),
        adjust: vi.fn().mockImplementation(async ({ amount }: { amount: number }) => 40 + amount),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      const { balance } = await svc.adjustCredits({
        userId: "u1",
        delta: 35,
        note: "恒等式",
        adminId: "admin-op",
      });
      expect(balance - 40).toBe(35); // 余额变化 == delta == 流水 amount
      expect(capturedAuditInputs[0]).toMatchObject({
        before: { balance: 40 },
        after: { balance: 75, delta: 35 },
      });
    });
  });

  describe("setTaskPrice（M2 task 5.2）", () => {
    it("改价：事务内读 before → upsert → 审计 pricing.update（前后单价）", async () => {
      const txLedger = makeLedger({
        getPrice: vi.fn().mockResolvedValueOnce(10).mockResolvedValue(10),
        setPrice: vi.fn().mockResolvedValue({ key: "generate_image", credits: 15 }),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await svc.setTaskPrice({ key: "generate_image", credits: 15, adminId: "admin-op", note: "涨价" });
      expect(txLedger.setPrice).toHaveBeenCalledWith("generate_image", 15);
      expect(capturedAuditInputs).toEqual([
        {
          adminUserId: "admin-op",
          action: "pricing.update",
          targetType: "credit_price",
          targetId: "generate_image",
          before: { credits: 10 },
          after: { credits: 15 },
          note: "涨价",
        },
      ]);
    });

    it("新建价目：before 为 null 的审计", async () => {
      const txLedger = makeLedger({
        getPrice: vi.fn().mockResolvedValue(null),
        setPrice: vi.fn().mockResolvedValue({ key: "render_html", credits: 5 }),
      });
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await svc.setTaskPrice({ key: "render_html", credits: 5, adminId: "admin-op" });
      expect(capturedAuditInputs[0]).toMatchObject({
        action: "pricing.update",
        targetId: "render_html",
        before: { credits: null },
        after: { credits: 5 },
      });
    });

    it("非法单价（负数/非整数）：拒绝不触库不落审计", async () => {
      const txLedger = makeLedger();
      const svc = createCreditsService(passthroughDeps(makeTxRepos({ ledger: txLedger })));

      await expect(
        svc.setTaskPrice({ key: "k", credits: -1, adminId: "a" }),
      ).rejects.toMatchObject({ kind: "pricing_invalid" });
      await expect(
        svc.setTaskPrice({ key: "k", credits: 1.5, adminId: "a" }),
      ).rejects.toMatchObject({ kind: "pricing_invalid" });
      expect(txLedger.setPrice).not.toHaveBeenCalled();
      expect(capturedAuditInputs).toEqual([]);
    });

    it("改价后新任务按新价冻结：freezeForTask 读取改后价（mock 层断言）", async () => {
      // setPrice 写入后 getPrice 返回新值（同一 repo 实例）；freezeForTask 每次实时读价
      let currentPrice = 10;
      const txLedger = makeLedger({
        getPrice: vi.fn().mockImplementation(async () => currentPrice),
        setPrice: vi.fn().mockImplementation(async (_key: string, credits: number) => {
          currentPrice = credits;
          return { key: "generate_image", credits };
        }),
        freeze: vi.fn().mockResolvedValue({ id: "l1" }),
      });
      const tasksRepo = {
        create: vi.fn().mockResolvedValue({ id: "t-new" }),
        setStatus: vi.fn(),
        appendEvent: vi.fn(),
      };
      const svc = createCreditsService({
        // freezeForTask 读价走顶层 ledger，须与事务内 repo 同源（同一 currentPrice 闭包）
        ledger: txLedger,
        ...passthroughDeps({ ledger: txLedger, tasks: tasksRepo as unknown as TaskRepo }),
      });

      // 旧价 10 → 冻结 10
      await svc.freezeForTask({ userId: "u1", type: "generate_image", payload: {} });
      expect(txLedger.freeze).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", price: 10 }),
      );
      // 改价为 15 → 新任务冻结 15
      await svc.setTaskPrice({ key: "generate_image", credits: 15, adminId: "admin-op" });
      await svc.freezeForTask({ userId: "u1", type: "generate_image", payload: {} });
      expect(txLedger.freeze).toHaveBeenLastCalledWith(
        expect.objectContaining({ price: 15 }),
      );
    });
  });
});
