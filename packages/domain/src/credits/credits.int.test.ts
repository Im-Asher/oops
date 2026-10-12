import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@oops/db";
import { createCreditLedgerRepo, InsufficientCreditsError } from "@oops/db/credit-ledger.repo";
import { createTaskRepo } from "@oops/db/task.repo";
import { creditLedger, tasks, users } from "@oops/db/schema";
import { eq } from "drizzle-orm";
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
});
