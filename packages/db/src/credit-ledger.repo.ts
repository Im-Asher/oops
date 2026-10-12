import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type ExtractTablesWithRelations,
} from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from ".";
import { creditLedger, creditPrices, tasks, users } from "./schema";
import type { CreditLedgerEntry, CreditPrice } from "./schema";

/**
 * 事务兼容客户端：连接池（NodePgDatabase）与事务（PgTransaction）的共同基类。
 * 仓储方法只用 select/insert/update，基类签名已覆盖。
 */
export type DbClient = PgDatabase<
  NodePgQueryResultHKT,
  typeof import("./schema"),
  ExtractTablesWithRelations<typeof import("./schema")>
>;

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
  /** 结算：按任务定位冻结条目，退差 delta = 冻结额 − 实际成本（actualCost 缺省 = 冻结额），条目转 settled。 */
  settle(input: { taskId: string; actualCost?: number }): Promise<void>;
  /** 按任务释放：返还全部冻结额 + 条目转 released + release 流水。 */
  releaseByTask(input: { taskId: string }): Promise<void>;
  /** 按条目释放（对账兜底用：任务可能已被删，taskId 被 FK 置空无法按任务定位）。 */
  releaseEntry(entryId: string): Promise<void>;
  /**
   * 发放 / 后台调整：带符号金额流水 + 余额增减。负数走条件 UPDATE
   * （行锁 + WHERE 余额充足，0 行即不足抛 InsufficientCreditsError，与 freeze 同构防超扣）；
   * 返回调整后余额，供审计 after 值复用。
   */
  adjust(input: { userId: string; amount: number; type: "grant" | "adjust"; note?: string }): Promise<number>;
  getBalance(userId: string): Promise<number>;
  getPrice(key: string): Promise<number | null>;
  listLeakedFrozen(): Promise<LeakedFrozen[]>;
  /** 积分流水查询（createdAt 倒序分页）：用户/类型/时间范围过滤，管理台流水页用。 */
  listLedger(input: {
    userId?: string;
    type?: "freeze" | "settle" | "release" | "grant" | "adjust";
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: CreditLedgerEntry[]; total: number; page: number; pageSize: number }>;
  /** 全部价目（按 key 排序），定价编辑页清单。 */
  listPrices(): Promise<CreditPrice[]>;
  /**
   * 改价（upsert）：key 不存在即新建价目。返回 upsert 后行；审计 before 值由
   * 调用方（domain service）先行 getPrice 取得，保持读写分离。
   */
  setPrice(key: string, credits: number): Promise<CreditPrice>;
  /**
   * 恒等式对账：balance == Σ(该用户全部流水金额)。全量用户拉取 + JS 比对
   * （管理台用户量级小；leftJoin 聚合会漏「无流水但余额非 0」的不一致用户）。
   * 只返回不一致清单，空数组即「全部一致」。
   */
  reconcileBalances(): Promise<
    Array<{ userId: string; username: string; balance: number; ledgerSum: number }>
  >;
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

    async settle({ taskId, actualCost }) {
      const [entry] = await db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.taskId, taskId), eq(creditLedger.status, "frozen")))
        .limit(1);
      if (!entry) return; // 无冻结条目（理论不可达）：幂等跳过，不产生流水
      const frozen = -entry.amount; // amount 为负存冻结额
      const delta = frozen - (actualCost ?? frozen);
      if (delta !== 0) {
        await db
          .update(users)
          .set({ creditBalance: sql`${users.creditBalance} + ${delta}` })
          .where(eq(users.id, entry.userId));
        await db
          .insert(creditLedger)
          .values({ userId: entry.userId, type: "settle", amount: delta, taskId });
      }
      await db
        .update(creditLedger)
        .set({ status: "settled" })
        .where(eq(creditLedger.id, entry.id));
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
      // 负数 = 扣减：条件 UPDATE 防超扣（与 freeze 同一并发正确性边界）
      const updated =
        amount < 0
          ? await db
              .update(users)
              .set({ creditBalance: sql`${users.creditBalance} + ${amount}` })
              .where(and(eq(users.id, userId), gte(users.creditBalance, -amount)))
              .returning({ balance: users.creditBalance })
          : await db
              .update(users)
              .set({ creditBalance: sql`${users.creditBalance} + ${amount}` })
              .where(eq(users.id, userId))
              .returning({ balance: users.creditBalance });
      if (updated.length === 0) {
        throw new InsufficientCreditsError();
      }
      await db.insert(creditLedger).values({ userId, type, amount, note });
      return updated[0].balance;
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

    async listLedger({ userId, type, from, to, page, pageSize }) {
      // 先 count 后分页（同 listForAdmin 双查询序）；过滤条件全部可选按 and 组合
      const filters = [
        userId ? eq(creditLedger.userId, userId) : undefined,
        type ? eq(creditLedger.type, type) : undefined,
        from ? gte(creditLedger.createdAt, from) : undefined,
        to ? lte(creditLedger.createdAt, to) : undefined,
      ].filter((f) => f !== undefined);
      const where = filters.length > 0 ? and(...filters) : undefined;

      // 条件链：无过滤时不走 where（op 序保持可断言）
      const countBase = db.select({ count: sql<number>`count(*)::int` }).from(creditLedger);
      const [countRow] = await (where ? countBase.where(where) : countBase);
      const rowsBase = db.select().from(creditLedger);
      const items = await (where ? rowsBase.where(where) : rowsBase)
        .orderBy(desc(creditLedger.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items, total: countRow?.count ?? 0, page, pageSize };
    },

    async listPrices() {
      return db.select().from(creditPrices).orderBy(asc(creditPrices.key));
    },

    async setPrice(key, credits) {
      const [row] = await db
        .insert(creditPrices)
        .values({ key, credits })
        .onConflictDoUpdate({
          target: creditPrices.key,
          set: { credits, updatedAt: new Date() },
        })
        .returning();
      return row;
    },

    async reconcileBalances() {
      // 全量用户 + 按 userId 聚合流水（两条独立查询 + JS 比对，避免 correlated
      // 聚合的 text/uuid 转换坑），无流水用户的 ledgerSum 记 0
      const allUsers = await db
        .select({ id: users.id, username: users.username, balance: users.creditBalance })
        .from(users);
      const sums = await db
        .select({
          userId: creditLedger.userId,
          sum: sql<number>`sum(${creditLedger.amount})::int`,
        })
        .from(creditLedger)
        .groupBy(creditLedger.userId);
      const sumByUser = new Map(sums.map((s) => [s.userId, s.sum]));
      return allUsers
        .filter((u) => u.balance !== (sumByUser.get(u.id) ?? 0))
        .map((u) => ({
          userId: u.id,
          username: u.username,
          balance: u.balance,
          ledgerSum: sumByUser.get(u.id) ?? 0,
        }));
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
