import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbClient } from "./credit-ledger.repo";
import { db as defaultDb } from ".";
import { tasks, type Task } from "./schema";

export interface TaskInput {
  type?: "generate_image" | "render_html" | "export";
  payload?: unknown;
  sessionId?: string;
  userId: string;
}

export interface TaskRepo {
  create(input: TaskInput): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(
    id: string,
    patch: {
      status?: "pending" | "running" | "succeeded" | "failed" | "canceled";
      result?: unknown;
      error?: string;
    },
  ): Promise<Task | undefined>;
  list(sessionId?: string): Promise<Task[]>;
}

export function createTaskRepo(db: DbClient = defaultDb): TaskRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(tasks)
        .values({
          type: input.type ?? "generate_image",
          payload: (input.payload as Record<string, unknown>) ?? {},
          sessionId: input.sessionId,
          userId: input.userId,
        })
        .returning();
      return row;
    },

    async get(id) {
      const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return rows[0];
    },

    async update(id, patch) {
      const [row] = await db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();
      return row;
    },

    async list(sessionId) {
      return db
        .select()
        .from(tasks)
        .where(sessionId ? eq(tasks.sessionId, sessionId) : undefined)
        .orderBy(desc(tasks.createdAt))
        .limit(500);
    },
  };
}

export type TaskStatus = Task["status"];

const TERMINAL_STATUSES: readonly TaskStatus[] = ["succeeded", "failed", "canceled"];

export interface TaskDashboardStats {
  /** 全量存量状态分布（当前在库口径，不受窗口影响） */
  statusCounts: Record<TaskStatus, number>;
  window: {
    startedAt: Date;
    /** 窗口内终态任务数（失败率分母） */
    terminalCount: number;
    failedCount: number;
    /** 无终态任务时 null（避免 0/0 歧义） */
    failureRate: number | null;
    /** 终态行 updatedAt−createdAt 均值；无终态任务时 null */
    avgDurationMs: number | null;
  };
  /** 全量最近失败（排查历史故障，不限窗口） */
  recentFailures: Task[];
}

/**
 * 看板只读聚合（task 7.1）。statusCounts/recentFailures 走 SQL 聚合；
 * 窗口失败率与平均耗时拉窗口内终态行后按 JS 口径计算（可被内存夹具验证，
 * 行数受窗口约束有限），失败率 = failed / 终态数。
 */
export async function getTaskDashboardStats(
  db: DbClient,
  windowHours = 24,
): Promise<TaskDashboardStats> {
  const startedAt = new Date(Date.now() - windowHours * 3_600_000);
  const emptyCounts: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
  };

  // 链尾统一 execute()：drizzle 语义等价，且 mock-db 按 TERMINAL 调用顺序出队 selectQueue
  const [groupRows, windowRows, failures] = await Promise.all([
    db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.status)
      .execute(),
    db
      .select({ status: tasks.status, durationMs: sql<number>`(extract(epoch from (${tasks.updatedAt} - ${tasks.createdAt})) * 1000)::int` })
      .from(tasks)
      .where(and(inArray(tasks.status, [...TERMINAL_STATUSES]), gte(tasks.updatedAt, startedAt)))
      .execute(),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "failed"))
      .orderBy(desc(tasks.updatedAt))
      .limit(20)
      .execute(),
  ]);

  const statusCounts = { ...emptyCounts };
  for (const row of groupRows) {
    statusCounts[row.status] = Number(row.count);
  }

  const terminalRows = windowRows.filter((r) =>
    (TERMINAL_STATUSES as readonly string[]).includes(r.status),
  );
  const failedCount = terminalRows.filter((r) => r.status === "failed").length;
  const avgDurationMs =
    terminalRows.length === 0
      ? null
      : Math.round(
          terminalRows.reduce((sum, r) => sum + Math.max(0, Number(r.durationMs)), 0) /
            terminalRows.length,
        );

  return {
    statusCounts,
    window: {
      startedAt,
      terminalCount: terminalRows.length,
      failedCount,
      failureRate: terminalRows.length === 0 ? null : failedCount / terminalRows.length,
      avgDurationMs,
    },
    recentFailures: failures,
  };
}
