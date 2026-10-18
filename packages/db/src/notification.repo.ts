import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db as defaultDb } from ".";
import type { DbClient } from "./credit-ledger.repo";
import { notifications, userNotifications, users } from "./schema";

/**
 * 站内信取值常量集（text 列 + 应用层约束，同admin_audit_log 范式）：
 * 取值集随来源与运营需求增长，pgEnum 改型需 DDL。
 */
export const NOTIFICATION_SOURCES = ["system", "admin"] as const;
export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

export const NOTIFICATION_LEVELS = ["info", "warning", "critical"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_AUDIENCES = ["all", "users"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/**
 * 消息类别：credits.* 为系统自动产生（带 i18nKey，客户端按 key 渲染），
 * admin.* 为管理员手写（无 i18nKey，原样展示）。
 */
export const NOTIFICATION_CATEGORIES = [
  "credits.low",
  "credits.exhausted",
  "admin.broadcast",
  "admin.direct",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** 扇出单批插入上限：全体广播在用户量增长后不至于拼出超大 VALUES 列表。 */
const FANOUT_BATCH_SIZE = 500;

export interface SendNotificationInput {
  source: NotificationSource;
  category: NotificationCategory;
  level: NotificationLevel;
  /** 中文原文：系统消息仅在词典缺键时兜底，管理员消息直接展示 */
  title: string;
  body: string;
  /** 系统消息的词典键与参数；管理员消息省略 */
  i18nKey?: string;
  i18nParams?: Record<string, unknown>;
  audience: NotificationAudience;
  /** audience=users 时的目标用户；audience=all 时由调用方解析后传入 */
  targetUserIds: string[];
  /** 管理员 users.id（source=system 时为 null） */
  createdBy?: string;
}

/**
 * 用户侧列表项：消息主体 + 该用户自己的已读状态（join 后拍平）。
 * source/category/level 为 text 列，DB 不约束取值，故按 string 返回；
 * 联合类型只出现在输入侧（SendNotificationInput / 查询条件），由domain service 校验。
 */
export interface UserNotificationView {
  id: string;
  source: string;
  category: string;
  level: string;
  title: string;
  body: string;
  i18nKey: string | null;
  i18nParams: unknown;
  createdAt: Date;
  readAt: Date | null;
}

/** 管理端列表项：主体 + 投递统计（目标人数 / 已读人数）。 */
export interface AdminNotificationView {
  id: string;
  source: string;
  category: string;
  level: string;
  title: string;
  body: string;
  audience: string;
  createdBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  targetCount: number;
  readCount: number;
}

export interface AdminNotificationDetail {
  notification: AdminNotificationView;
  readBy: Array<{ userId: string; username: string; displayName: string | null; readAt: Date }>;
}

export interface UserListQuery {
  userId: string;
  page: number;
  pageSize: number;
  source?: NotificationSource;
}

export interface AdminListQuery {
  page: number;
  pageSize: number;
  source?: NotificationSource;
  /** 标题/正文模糊匹配 */
  keyword?: string;
  /** active 仅未撤回（缺省） / revoked 仅已撤回 / all 全部 */
  revoked?: "active" | "revoked" | "all";
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationRepo {
  /**
   * 创建消息并写时扇出：主记录 + 每位受众一行投递记录，同一客户端（事务内）完成，
   * 任一步失败由外层事务整体回滚，不留部分投递。扇出按批切分避免超大 VALUES。
   */
  createWithDelivery(input: SendNotificationInput): Promise<AdminNotificationView>;
  /** 可接收用户（全体广播的受众解析）：active 用户，停用者不收消息。 */
  listReceivableUserIds(): Promise<string[]>;
  /** 用户侧分页列表：仅本人投递且未撤回的消息，createdAt 倒序。 */
  listForUser(query: UserListQuery): Promise<Page<UserNotificationView>>;
  /** 未读计数：投递未标记已读且消息未撤回。 */
  countUnread(userId: string): Promise<number>;
  /** 单条标记已读；非本人投递或消息已撤回时返回 false（不抛错，路由层据此回 404）。 */
  markRead(userId: string, notificationId: string): Promise<boolean>;
  /** 全部已读：返回本次标记条数。 */
  markAllRead(userId: string): Promise<number>;
  /** 管理端分页列表（含投递统计与已撤回标识）。 */
  listForAdmin(query: AdminListQuery): Promise<Page<AdminNotificationView>>;
  /** 管理端详情：主体统计 + 已读用户明细。 */
  getAdminDetail(id: string): Promise<AdminNotificationDetail | null>;
  /** 撤回：置位 revokedAt；已撤回或不存在返回 false（重复撤回被拒）。 */
  revoke(id: string): Promise<boolean>;
  /**
   * 该用户最近一条指定类别消息的时刻（无则 null）：积分通知的「已通知过」判据，
   * 与 credit_ledger 的最近正向流水时刻比较即得复位状态（见 design.md D6）。
   */
  findLatestCategoryAt(userId: string, category: NotificationCategory): Promise<Date | null>;
  /** 保留期清理：删除已读且投递早于 cutoff 的行，返回删除条数；消息主体不动。 */
  deleteReadBefore(cutoff: Date): Promise<number>;
}

/** join 后拍平用户侧列表项（select 形状与 UserNotificationView 对齐）。 */
const userViewColumns = {
  id: notifications.id,
  source: notifications.source,
  category: notifications.category,
  level: notifications.level,
  title: notifications.title,
  body: notifications.body,
  i18nKey: notifications.i18nKey,
  i18nParams: notifications.i18nParams,
  createdAt: notifications.createdAt,
  readAt: userNotifications.readAt,
};

/** join 后拍平管理端列表项 + 两个聚合计数。 */
const adminViewColumns = {
  id: notifications.id,
  source: notifications.source,
  category: notifications.category,
  level: notifications.level,
  title: notifications.title,
  body: notifications.body,
  audience: notifications.audience,
  createdBy: notifications.createdBy,
  revokedAt: notifications.revokedAt,
  createdAt: notifications.createdAt,
  targetCount: count(userNotifications.userId),
  readCount: count(userNotifications.readAt),
};

/** 未撤回消息的存在性子句：标记已读时与已撤回消息隔离。 */
const notRevoked = sql`exists (
  select 1 from ${notifications}
  where ${notifications.id} = ${userNotifications.notificationId}
    and ${notifications.revokedAt} is null
)`;

export function createNotificationRepo(db: DbClient = defaultDb): NotificationRepo {
  return {
    async createWithDelivery(input) {
      const [notification] = await db
        .insert(notifications)
        .values({
          source: input.source,
          category: input.category,
          level: input.level,
          title: input.title,
          body: input.body,
          ...(input.i18nKey !== undefined && { i18nKey: input.i18nKey }),
          ...(input.i18nParams !== undefined && { i18nParams: input.i18nParams }),
          audience: input.audience,
          ...(input.createdBy !== undefined && { createdBy: input.createdBy }),
        })
        .returning();

      for (let i = 0; i < input.targetUserIds.length; i += FANOUT_BATCH_SIZE) {
        const batch = input.targetUserIds.slice(i, i + FANOUT_BATCH_SIZE);
        await db.insert(userNotifications).values(
          batch.map((userId) => ({ userId, notificationId: notification.id })),
        );
      }

      return {
        ...notification,
        targetCount: input.targetUserIds.length,
        readCount: 0,
      };
    },

    async listReceivableUserIds() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.status, "active"));
      return rows.map((r) => r.id);
    },

    async listForUser({ userId, page, pageSize, source }) {
      const filters = [
        eq(userNotifications.userId, userId),
        isNull(notifications.revokedAt),
        source ? eq(notifications.source, source) : undefined,
      ].filter((f) => f !== undefined);
      const where = and(...filters);

      const [countRow] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(userNotifications)
        .innerJoin(notifications, eq(userNotifications.notificationId, notifications.id))
        .where(where);
      const items = await db
        .select(userViewColumns)
        .from(userNotifications)
        .innerJoin(notifications, eq(userNotifications.notificationId, notifications.id))
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items, total: countRow?.value ?? 0, page, pageSize };
    },

    async countUnread(userId) {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(userNotifications)
        .innerJoin(notifications, eq(userNotifications.notificationId, notifications.id))
        .where(
          and(
            eq(userNotifications.userId, userId),
            isNull(userNotifications.readAt),
            isNull(notifications.revokedAt),
          ),
        );
      return row?.value ?? 0;
    },

    async markRead(userId, notificationId) {
      // WHERE 里带存在性子句：非本人投递与已撤回消息都不落read_at（路由层回 404）
      const updated = await db
        .update(userNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.notificationId, notificationId),
            isNull(userNotifications.readAt),
            notRevoked,
          ),
        )
        .returning({ notificationId: userNotifications.notificationId });
      // 已读重复提交视为成功（幂等）：仅当投递不存在或已撤回时才返回 false
      if (updated.length > 0) return true;
      const existing = await db
        .select({ readAt: userNotifications.readAt })
        .from(userNotifications)
        .innerJoin(notifications, eq(userNotifications.notificationId, notifications.id))
        .where(
          and(
            eq(userNotifications.userId, userId),
            eq(userNotifications.notificationId, notificationId),
            isNull(notifications.revokedAt),
          ),
        )
        .limit(1);
      return existing.length > 0;
    },

    async markAllRead(userId) {
      const updated = await db
        .update(userNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(userNotifications.userId, userId),
            isNull(userNotifications.readAt),
            notRevoked,
          ),
        )
        .returning({ notificationId: userNotifications.notificationId });
      return updated.length;
    },

    async listForAdmin({ page, pageSize, source, keyword, revoked = "active" }) {
      const filters: SQL[] = [];
      if (source) filters.push(eq(notifications.source, source));
      if (keyword) {
        const pattern = `%${keyword}%`;
        filters.push(or(ilike(notifications.title, pattern), ilike(notifications.body, pattern))!);
      }
      if (revoked === "active") filters.push(isNull(notifications.revokedAt));
      if (revoked === "revoked") filters.push(isNotNull(notifications.revokedAt));
      const where = filters.length > 0 ? and(...filters) : undefined;

      const countBase = db
        .select({ value: sql<number>`count(*)::int` })
        .from(notifications);
      const [countRow] = await (where ? countBase.where(where) : countBase);
      const itemsBase = db
        .select(adminViewColumns)
        .from(notifications)
        .leftJoin(userNotifications, eq(userNotifications.notificationId, notifications.id));
      const items = await (where ? itemsBase.where(where) : itemsBase)
        .groupBy(notifications.id)
        .orderBy(desc(notifications.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items, total: countRow?.value ?? 0, page, pageSize };
    },

    async getAdminDetail(id) {
      const rows = await db
        .select(adminViewColumns)
        .from(notifications)
        .leftJoin(userNotifications, eq(userNotifications.notificationId, notifications.id))
        .where(eq(notifications.id, id))
        .groupBy(notifications.id)
        .limit(1);
      const notification = rows[0];
      if (!notification) return null;

      const readRows = await db
        .select({
          userId: userNotifications.userId,
          readAt: userNotifications.readAt,
        })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.notificationId, id),
            isNotNull(userNotifications.readAt),
          ),
        )
        .orderBy(asc(userNotifications.readAt));

      // users.id 是 uuid 而 user_notifications.user_id 是 text，直接 join 会被 PG
      // 判为「uuid = text」无有效比较（同 credit-ledger.listAll 的坑）：改为两次查询 + JS 映射
      const profiles =
        readRows.length === 0
          ? []
          : await db
              .select({ id: users.id, username: users.username, displayName: users.displayName })
              .from(users)
              .where(inArray(users.id, readRows.map((r) => r.userId)));
      const profileById = new Map(profiles.map((p) => [p.id, p]));

      return {
        notification,
        readBy: readRows.map((r) => ({
          userId: r.userId,
          // 用户行缺失只在将来支持删用户时才可能出现（MVP 无此路径），此处不静默吞掉
          username: profileById.get(r.userId)?.username ?? "",
          displayName: profileById.get(r.userId)?.displayName ?? null,
          readAt: r.readAt as Date,
        })),
      };
    },

    async revoke(id) {
      // WHERE revoked_at IS NULL：已撤回消息再次撤回落空行，调用方据此拒绝
      const updated = await db
        .update(notifications)
        .set({ revokedAt: new Date() })
        .where(and(eq(notifications.id, id), isNull(notifications.revokedAt)))
        .returning({ id: notifications.id });
      return updated.length > 0;
    },

    async findLatestCategoryAt(userId, category) {
      const [row] = await db
        .select({ createdAt: notifications.createdAt })
        .from(userNotifications)
        .innerJoin(notifications, eq(userNotifications.notificationId, notifications.id))
        .where(
          and(eq(userNotifications.userId, userId), eq(notifications.category, category)),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(1);
      return row?.createdAt ?? null;
    },

    async deleteReadBefore(cutoff) {
      // 已读且早于 cutoff 才清理：未读记录长期保留（用户可能还没看到），消息主体一律不动
      const deleted = await db
        .delete(userNotifications)
        .where(and(isNotNull(userNotifications.readAt), lt(userNotifications.readAt, cutoff)))
        .returning({ notificationId: userNotifications.notificationId });
      return deleted.length;
    },
  };
}