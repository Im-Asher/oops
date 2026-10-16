import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@oops/db";
import { createCreditLedgerRepo, InsufficientCreditsError } from "@oops/db/credit-ledger.repo";
import { createTaskRepo } from "@oops/db/task.repo";
import { adminAuditLog, creditLedger, creditPrices, tasks, users } from "@oops/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { creditsService } from "./service";
import { TaskError } from "../tasks/task-error";

/**
 * 真 PG 集成测试：验证 mock 无法覆盖的数据库层语义——
 * 条件 UPDATE 并发原子性、事务回滚（冻结失败无任务行）、账本不变量。
 * 需要可达的 Postgres：RUN_PG_TESTS=1 + DATABASE_URL 指向真实库（dev: docker oops-postgres）。
 */
const shouldRun = process.env.RUN_PG_TESTS === "1";

describe.skipIf(!shouldRun)("credits integration (real PG)", () => {
  // users.id 是 uuid 类型，账本 user_id 为 text：以 uuid 字符串贯穿两表
  const userId = crypto.randomUUID();
  const ledger = createCreditLedgerRepo();
  const taskRepo = createTaskRepo();

  beforeAll(async () => {
    await db.insert(users).values({
      id: userId,
      username: `credits-int-${userId.slice(0, 8)}`,
      oopsId: userId.replaceAll("-", "").slice(0, 8),
      passwordHash: "x",
      displayName: "credits-int",
      creditBalance: 100,
    });
  });

  afterAll(async () => {
    // 先删从表再删主行：ledger/task 的 user_id 无 FK，任务 task_id FK 置空不阻塞
    await db.delete(creditLedger).where(eq(creditLedger.userId, userId));
    await db.delete(tasks).where(eq(tasks.userId, userId));
    await db.delete(adminAuditLog).where(eq(adminAuditLog.targetId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("并发冻结原子性：余额 10 时 3 个并发冻结（单价 10）恰好成功 1 个", async () => {
    // 精确置 10：只有 1 笔冻结的额度，才能验证行锁防止超扣
    await db.update(users).set({ creditBalance: 10 }).where(eq(users.id, userId));
    const taskIds = await Promise.all(
      Array.from({ length: 3 }, () =>
        taskRepo.create({ userId, type: "generate_image", payload: {} }).then((t) => t.id),
      ),
    );
    const attempts = taskIds.map((taskId) => ledger.freeze({ userId, taskId, price: 10 }));
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientCreditsError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    await expect(ledger.getBalance(userId)).resolves.toBe(0);
  });

  it("事务回滚：余额不足时 freezeForTask 不留任务行、不动余额", async () => {
    const before = await ledger.getBalance(userId);
    const tasksBefore = (await taskRepo.list()).filter((t) => t.userId === userId).length;
    await expect(
      creditsService.freezeForTask({ userId, type: "generate_image", payload: {} }),
    ).rejects.toBeInstanceOf(TaskError);
    await expect(
      creditsService.freezeForTask({ userId, type: "generate_image", payload: {} }),
    ).rejects.toMatchObject({ kind: "insufficient_credits" });
    const tasksAfter = (await taskRepo.list()).filter((t) => t.userId === userId).length;
    expect(tasksAfter).toBe(tasksBefore);
    await expect(ledger.getBalance(userId)).resolves.toBe(before);
  });

  it("成功结算退差：冻结 10 实扣 8 → 余额 +2，冻结条目转 settled", async () => {
    await ledger.adjust({ userId, amount: 100, type: "adjust", note: "setup" });
    const { taskId } = await creditsService.freezeForTask({
      userId,
      type: "generate_image",
      payload: {},
    });
    // 前置测试后余额为 0：+100 → 冻结 -10 → 实扣退差 +2 = 92
    await creditsService.settle(taskId, 8);
    await expect(ledger.getBalance(userId)).resolves.toBe(92);
  });

  it("失败释放：releaseByTask 返还冻结额且条目转 released", async () => {
    await ledger.adjust({ userId, amount: 100, type: "adjust", note: "setup" });
    const { taskId } = await creditsService.freezeForTask({
      userId,
      type: "generate_image",
      payload: {},
    });
    const before = await ledger.getBalance(userId);
    await creditsService.release(taskId);
    await expect(ledger.getBalance(userId)).resolves.toBe(before + 10);
    const leaks = await ledger.listLeakedFrozen();
    expect(leaks.find((l) => l.taskId === taskId)).toBeUndefined();
  });

  it("对账兜底：终态任务与已删任务的 frozen 条目被 listLeakedFrozen 命中并释放", async () => {
    await ledger.adjust({ userId, amount: 50, type: "adjust", note: "setup" });
    // 场景 A：任务已终态（succeeded）但冻结条目未结算（结算钩子未走完的崩溃残余）
    const settled = await taskRepo.create({ userId, type: "generate_image", payload: {} });
    await ledger.freeze({ userId, taskId: settled.id, price: 5 });
    await taskRepo.update(settled.id, { status: "succeeded" });
    // 场景 B：任务行被删 → FK set null → orphan frozen（taskId 为 null）
    const removed = await taskRepo.create({ userId, type: "generate_image", payload: {} });
    await ledger.freeze({ userId, taskId: removed.id, price: 5 });
    await db.delete(tasks).where(eq(tasks.id, removed.id));

    const leaks = (await ledger.listLeakedFrozen()).filter((l) => l.userId === userId);
    expect(leaks).toHaveLength(2);
    for (const leak of leaks) {
      await ledger.releaseEntry(leak.entryId);
    }
    const after = (await ledger.listLeakedFrozen()).filter((l) => l.userId === userId);
    expect(after).toHaveLength(0);
  });

  it("adjustCredits 并发扣减不超扣：余额 100 两个并发 -80 恰好成功 1 个", async () => {
    await db.update(users).set({ creditBalance: 100 }).where(eq(users.id, userId));
    const attempts = Array.from({ length: 2 }, () =>
      creditsService.adjustCredits({
        userId,
        delta: -80,
        note: "并发扣减冒烟",
        adminId: crypto.randomUUID(),
      }),
    );
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientCreditsError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await expect(ledger.getBalance(userId)).resolves.toBe(20);
  });

  it("adjustCredits 审计同事务：成功落 credits.adjust（before/after 余额），失败无审计行", async () => {
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, "credits.adjust"), eq(adminAuditLog.targetId, userId)));
    expect(rows).toHaveLength(1); // 上一用例两笔尝试只落成功那笔
    expect(rows[0].before).toMatchObject({ balance: 100 });
    expect(rows[0].after).toMatchObject({ balance: 20, delta: -80 });
    expect(rows[0].note).toBe("并发扣减冒烟");
  });

  it("流水恒等式：adjust 后余额变化 == 流水金额，且 balance−Σ流水 守恒", async () => {
    const balanceDiff = sql<number>`(${users.creditBalance} - coalesce((
      select sum(${creditLedger.amount})::int from ${creditLedger}
      where ${creditLedger.userId} = ${userId}
    ), 0))::int`;
    const [k1] = await db.select({ k: balanceDiff }).from(users).where(eq(users.id, userId));
    const before = await ledger.getBalance(userId);
    await creditsService.adjustCredits({
      userId,
      delta: 37,
      note: "恒等式",
      adminId: crypto.randomUUID(),
    });
    const after = await ledger.getBalance(userId);
    expect(after - before).toBe(37);
    // 守恒：余额变动完全由流水解释（无流水 set 会破坏守恒——本用例窗口内无此类操作）
    const [k2] = await db.select({ k: balanceDiff }).from(users).where(eq(users.id, userId));
    expect(k2.k).toBe(k1.k);
  });

  it("setTaskPrice：真库 upsert 新建/更新价目，审计 pricing.update 落 before/after 单价", async () => {
    // 新建价目：before 为 null
    await creditsService.setTaskPrice({ key: "int_test_price", credits: 7, adminId: "admin-int" });
    await expect(ledger.getPrice("int_test_price")).resolves.toBe(7);
    // 更新：before 取到改前值
    await creditsService.setTaskPrice({
      key: "int_test_price",
      credits: 9,
      adminId: "admin-int",
      note: "涨价",
    });
    await expect(ledger.getPrice("int_test_price")).resolves.toBe(9);
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(eq(adminAuditLog.action, "pricing.update"), eq(adminAuditLog.targetId, "int_test_price")),
      );
    expect(rows).toHaveLength(2);
    expect(rows[0].before).toEqual({ credits: null });
    expect(rows[0].after).toEqual({ credits: 7 });
    expect(rows[1].before).toEqual({ credits: 7 });
    expect(rows[1].after).toEqual({ credits: 9 });
    expect(rows[1].note).toBe("涨价");
    // 清理：价目 key 不含 userId，显式删除审计与价目行
    await db.delete(adminAuditLog).where(eq(adminAuditLog.targetId, "int_test_price"));
    await db.delete(creditPrices).where(eq(creditPrices.key, "int_test_price"));
  });

  it("reconcileBalances：绕过账本改余额被命中并给出双值；零流水用户保持一致", async () => {
    // 本文件早前用例有无流水 set（历史偏差），不假设初始一致：以首次扫描取
    // 该用户流水合计为基线，断言「人为改余额后 hit 的双值」这一增量事实
    const scan1 = await ledger.reconcileBalances();
    const hit1 = scan1.find((m) => m.userId === userId);
    const sum1 = hit1 ? hit1.ledgerSum : (await ledger.getBalance(userId)); // 无 hit = sum == balance

    // 直接 UPDATE 余额（绕过账本，模拟对账要抓的真实偏差）
    await db
      .update(users)
      .set({ creditBalance: sum1 + 999 })
      .where(eq(users.id, userId));
    const scan2 = await ledger.reconcileBalances();
    const hit2 = scan2.find((m) => m.userId === userId);
    expect(hit2).toBeDefined();
    expect(hit2?.username).toBe(`credits-int-${userId.slice(0, 8)}`);
    expect(hit2?.balance).toBe(sum1 + 999);
    expect(hit2?.ledgerSum).toBe(sum1); // set 不写流水，合计不变

    // 零流水零余额用户走一致路径（sumByUser 缺省 0 分支），不出现
    const cleanId = crypto.randomUUID();
    await db.insert(users).values({
      id: cleanId,
      username: `credits-int-clean-${cleanId.slice(0, 8)}`,
      oopsId: cleanId.replaceAll("-", "").slice(0, 8),
      passwordHash: "x",
      displayName: "credits-int-clean",
      creditBalance: 0,
    });
    try {
      const scan3 = await ledger.reconcileBalances();
      expect(scan3.find((m) => m.userId === cleanId)).toBeUndefined();
    } finally {
      await db.delete(users).where(eq(users.id, cleanId));
    }
  });
});
