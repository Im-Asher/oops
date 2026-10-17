import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db as defaultDb } from ".";
import { adminAuditLog, type AdminAuditLog } from "./schema";
import type { DbClient } from "./credit-ledger.repo";

/**
 * 审计动作常量集（text 列 + 应用层约束，动作集随管理面增长免 DDL）：
 * user.status_change 用户启停 / invite.create 邀请码生成 / invite.revoke 邀请码作废 /
 * credits.adjust 积分发放扣减 / pricing.update 定价修改 / agent.toggle Agent 启停 /
 * model.config 模型目录启停与角色默认模型变更 /
 * auth.login 管理员登录（覆盖面中唯一的非写操作项，操作对象为该管理员自身）
 */
export const ADMIN_AUDIT_ACTIONS = [
  "auth.login",
  "user.status_change",
  "invite.create",
  "invite.revoke",
  "credits.adjust",
  "pricing.update",
  "agent.toggle",
  "model.config",
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** 操作对象类型常量集：model.config 同时覆盖目录启停与角色默认模型。 */
export const ADMIN_AUDIT_TARGET_TYPES = [
  "user",
  "invite_code",
  "credit_price",
  "agent",
  "model_config",
] as const;
export type AdminAuditTargetType = (typeof ADMIN_AUDIT_TARGET_TYPES)[number];

export interface AuditRecordInput {
  adminUserId: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  /** 批量生成等面向集合的动作可省略 */
  targetId?: string;
  /** 结构化前后值（jsonb）；创建类动作无 before */
  before?: unknown;
  after?: unknown;
  note?: string;
}

export interface AuditQuery {
  adminUserId?: string;
  action?: AdminAuditAction;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  /** 时间范围（含边界，createdAt） */
  from?: Date;
  to?: Date;
  /** 1-based，缺省 1 */
  page?: number;
  /** 缺省 20 */
  pageSize?: number;
}

export interface AuditPage {
  items: AdminAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAuditRepo {
  /**
   * append-only 面：仅 insert 与查询。update/delete 故意不暴露，
   * 审计记录不可篡改由仓储接口保证（spec「审计不可篡改」）。
   */
  record(input: AuditRecordInput): Promise<AdminAuditLog>;
  /** 过滤分页查询，createdAt 倒序。 */
  list(query: AuditQuery): Promise<AuditPage>;
}

export function createAdminAuditRepo(db: DbClient = defaultDb): AdminAuditRepo {
  return {
    async record(input) {
      if (!ADMIN_AUDIT_ACTIONS.includes(input.action)) {
        throw new Error(`未知审计动作：${input.action}`);
      }
      if (!ADMIN_AUDIT_TARGET_TYPES.includes(input.targetType)) {
        throw new Error(`未知审计对象类型：${input.targetType}`);
      }
      const [row] = await db
        .insert(adminAuditLog)
        .values({
          adminUserId: input.adminUserId,
          action: input.action,
          targetType: input.targetType,
          ...(input.targetId !== undefined && { targetId: input.targetId }),
          ...(input.before !== undefined && { before: input.before }),
          ...(input.after !== undefined && { after: input.after }),
          ...(input.note !== undefined && { note: input.note }),
        })
        .returning();
      return row;
    },

    async list(query) {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
      const conds: SQL[] = [];
      if (query.adminUserId) conds.push(eq(adminAuditLog.adminUserId, query.adminUserId));
      if (query.action) conds.push(eq(adminAuditLog.action, query.action));
      if (query.targetType) conds.push(eq(adminAuditLog.targetType, query.targetType));
      if (query.targetId) conds.push(eq(adminAuditLog.targetId, query.targetId));
      if (query.from) conds.push(gte(adminAuditLog.createdAt, query.from));
      if (query.to) conds.push(lte(adminAuditLog.createdAt, query.to));
      const where = conds.length > 0 ? and(...conds) : undefined;

      const [countRow] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(adminAuditLog)
        .where(where);
      const items = await db
        .select()
        .from(adminAuditLog)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items, total: countRow?.count ?? 0, page, pageSize };
    },
  };
}

/**
 * 业务变更与审计同一事务（spec「写操作全量审计」一致性要求）：
 * bizFn 成功后写审计行，任一失败整体回滚——业务成功而审计缺失、失败尝试落审计两类窗口都被消除。
 * before/after 由调用方在 bizFn 内读取业务数据构造，保证与事务内写入一致；
 * input 可传值，或传接收 bizFn 结果的函数以复用其返回值。
 */
export async function withAudit<T>(
  runTx: <R>(fn: (tx: DbClient) => Promise<R>) => Promise<R>,
  input: AuditRecordInput | ((result: T) => AuditRecordInput),
  bizFn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return runTx(async (tx) => {
    const result = await bizFn(tx);
    await createAdminAuditRepo(tx).record(
      typeof input === "function" ? input(result) : input,
    );
    return result;
  });
}
