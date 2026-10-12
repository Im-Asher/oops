import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb } from ".";
import { creditLedger, creditPrices, tasks, users } from "./schema";
import type { CreditLedgerEntry } from "./schema";

export type DbClient = typeof defaultDb;

export interface FreezeInput {
  userId: string;
  taskId: string;
  price: number;
}

/** 对账扫描行：仍 frozen 且任务已终态或已不存在（FK 置空）的冻结条目。 */
export interface LeakedFrozen {
  entryId: string;
  userId: string;
  amount: number;
  taskId: string | null;
}

export interface CreditLedgerRepo {
  /**
   * 冻结：条件 UPDATE 扣余额（并发正确性边界——行锁 + WHERE 余额充足，0 行即不足）
   * + frozen 流水插入。调用方须在同一事务内完成任务创建，余额不足抛错整体回滚。
   */
  freeze(input: FreezeInput): Promise<CreditLedgerEntry>;
  /** 结算退差：delta = 冻结额 − 实际成本（正退负补，可为 0），冻结条目转 settled。 */
  settle(input: { userId: string; taskId: string; delta: number }): Promise<void>;
  /** 按任务释放：返还全部冻结额 + 条目转 released + release 流水。 */
  releaseByTask(input: { taskId: string }): Promise<void>;
  /** 按条目释放（对账兜底用：任务可能已被删，taskId 被 FK 置空无法按任务定位）。 */
  releaseEntry(entryId: string): Promise<void>;
  /** 发放 / 后台调整：带符号金额流水 + 余额无条件增减。 */
  adjust(input: { userId: string; amount: number; type: "grant" | "adjust"; note?: string }): Promise<void>;
  getBalance(userId: string): Promise<number>;
  getPrice(key: string): Promise<number | null>;
  listLeakedFrozen(): Promise<LeakedFrozen[]>;
}

/** 任务终态（冻结不再合法停留的状态）；pending/running 属正常冻结期。 */
const TERMINAL_TASK_STATUSES = ["succeeded", "failed", "canceled"] as const;

/** 冻结失败信号（余额不足）：条件 UPDATE 0 行时抛出，事务调用方捕获后整体回滚。 */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient_credits");
    this.name = "InsufficientCreditsError";
  }
}

export function createCreditLedgerRepo(db: DbClient = defaultDb): CreditLedgerRepo {
  return {
    async freeze({ userId, taskId, price }) {
      // 条件 UPDATE：PG 行锁保证并发冻结不超扣；0 行 = 余额不足
      const updated = await db
        .update(users)
        .set({ creditBalance: sql`${users.creditBalance} - ${price}` })
        .where(and(eq(users.id, userId), gte(users.creditBalance, price)))
        .returning({ balance: users.creditBalance });
      if (updated.length === 0) {
        // 与成功路径同构地抛错，由事务调用方回滚任务创建
        throw new InsufficientCreditsError();
      }
      const [entry] = await db
        .insert(creditLedger)
        .values({ userId, type: "freeze", amount: -price, status: "frozen", taskId })
        .returning();
      return entry;
    },

    async settle({ userId, taskId, delta }) {
      if (delta !== 0) {
        await db
          .update(users)
          .set({ creditBalance: sql`${users.creditBalance} + ${delta}` })
          .where(eq(users.id, userId));
        await db
          .insert(creditLedger)
          .values({ userId, type: "settle", amount: delta, taskId });
      }
      await db
        .update(creditLedger)
        .set({ status: "settled" })
        .where(and(eq(creditLedger.taskId, taskId), eq(creditLedger.status, "frozen")));
    },

    async releaseByTask({ taskId }) {
      const frozen = await db
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(and(eq(creditLedger.taskId, taskId), eq(creditLedger.status, "frozen")));
      for (const row of frozen) {
        await releaseEntry(row.id);
      }
    },

    releaseEntry: (entryId) => releaseEntry(entryId),

    async adjust({ userId, amount, type, note }) {
      await db
        .update(users)
        .set({ creditBalance: sql`${users.creditBalance} + ${amount}` })
        .where(eq(users.id, userId));
      await db.insert(creditLedger).values({ userId, type, amount, note });
    },

    async getBalance(userId) {
      const [row] = await db
        .select({ balance: users.creditBalance })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.balance ?? 0;
    },

    async getPrice(key) {
      const [row] = await db
        .select({ credits: creditPrices.credits })
        .from(creditPrices)
        .where(eq(creditPrices.key, key))
        .limit(1);
      return row?.credits ?? null;
    },

    async listLeakedFrozen() {
      return db
        .select({
          entryId: creditLedger.id,
          userId: creditLedger.userId,
          amount: creditLedger.amount,
          taskId: creditLedger.taskId,
        })
        .from(creditLedger)
        .leftJoin(tasks, eq(creditLedger.taskId, tasks.id))
        .where(
          and(
            eq(creditLedger.status, "frozen"),
            // taskId 为 null = 任务已删（FK 置空）或从不存在；终态任务 = 结算钩子未走完的残余
            or(
              isNull(creditLedger.taskId),
              inArray(tasks.status, [...TERMINAL_TASK_STATUSES]),
            ),
          ),
        );
    },
  };

  /** 返还单笔冻结：amount 为负，余额减负数即加回；release 流水记正数。 */
  async function releaseEntry(entryId: string): Promise<void> {
    const [entry] = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.id, entryId), eq(creditLedger.status, "frozen")))
      .limit(1);
    if (!entry) return;
    await db
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} - ${entry.amount}` })
      .where(eq(users.id, entry.userId));
    await db
      .update(creditLedger)
      .set({ status: "released" })
      .where(eq(creditLedger.id, entryId));
    await db.insert(creditLedger).values({
      userId: entry.userId,
      type: "release",
      amount: -entry.amount,
      taskId: entry.taskId,
      note: "release",
    });
  }
}
