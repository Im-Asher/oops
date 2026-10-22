import { sql } from "drizzle-orm";
import { db as defaultDb } from "@oops/db";
import { withAudit } from "@oops/db/admin-audit.repo";
import { createCreditLedgerRepo, type CreditLedgerRepo, type DbClient } from "@oops/db/credit-ledger.repo";
import {
  createNotificationRepo,
  type AdminListQuery,
  type NotificationAudience,
  type NotificationCategory,
  type NotificationLevel,
  type NotificationRepo,
  type NotificationSource,
  type UserListQuery,
} from "@oops/db/notification.repo";

/** 投递记录保留期（天）：已读且超过该时长的投递行在启动清理时删除（spec「投递记录保留期」）。 */
export const RETENTION_DAYS = 90;

/**
 * 积分预警线（分）：余额 ≤ 此值且 > 0 时发「即将耗尽」，归零发「已耗尽」。
 * 取代码常量而非 app_config —— 管理端本期没有该配置项的编辑入口，
 * 先铺overlay 读取路径只付一半成本（见 design.md D9）。
 */
export const CREDITS_LOW_THRESHOLD = 20;

/** 积分通知的类别 / 级别 / 词典键映射（文案在web 词典，title/body 仅兜底）。 */
const CREDITS_NOTICE: Record<
  "credits.low" | "credits.exhausted",
  { level: NotificationLevel; i18nKey: string; title: string; body: (balance: number) => string }
> = {
  "credits.low": {
    level: "warning",
    i18nKey: "notifications.credits.low",
    title: "积分即将耗尽",
    body: (b) => `当前余额 ${b}，已低于预警线。余额耗尽后将无法继续生成。`,
  },
  "credits.exhausted": {
    level: "critical",
    i18nKey: "notifications.credits.exhausted",
    title: "积分已耗尽",
    body: (b) => `当前余额 ${b}，已无法继续生成，请联系管理员补充积分。`,
  },
};

/** notifyCreditsState 的判定结果：reason 供调用方与测试区分「为什么没发」。 */
export type CreditsNoticeResult =
  | { notified: true; category: "credits.low" | "credits.exhausted" }
  | { notified: false; reason: "above_threshold" | "already_notified" };

/** 领域错误：kind 供路由层映射状态码，message 为中文原文（不进用户界面词典）。 */
export class NotificationError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "empty_audience"
      | "admin_required"
      | "already_revoked"
      | "not_found"
      | "no_receivable_user",
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

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
  /** audience=users 时的目标用户；audience=all 时由服务解析全体 active 用户 */
  userIds?: string[];
  /** source=admin 时必填：操作管理员，落审计 */
  adminId?: string;
  note?: string;
}

export interface RevokeNotificationInput {
  id: string;
  adminId: string;
  note?: string;
}

export interface NotificationsService {
  /**
   * 发送：受众解析 → 主记录 + 写时扇出同一事务完成。
   * 管理员来源同事务落审计（message.send）；系统来源无操作者，只写业务。
   */
  send(input: SendNotificationInput): Promise<{ id: string; targetCount: number }>;
  /** 撤回：置位 revokedAt；已撤回/不存在被拒（不落审计，事务整体回滚）。 */
  revoke(input: RevokeNotificationInput): Promise<{ revokedAt: Date }>;
  /** 用户侧查询门面（撤回过滤与权限口径由仓储保证）。 */
  listForUser(query: UserListQuery): ReturnType<NotificationRepo["listForUser"]>;
  unreadCount(userId: string): Promise<number>;
  /** 单条已读；false = 非本人投递或已撤回（路由层回 404）。 */
  markRead(userId: string, notificationId: string): Promise<boolean>;
  markAllRead(userId: string): Promise<number>;
  /** 管理端查询门面。 */
  listForAdmin(query: AdminListQuery): ReturnType<NotificationRepo["listForAdmin"]>;
  getAdminDetail(id: string): ReturnType<NotificationRepo["getAdminDetail"]>;
  /** 启动清理：删除已读且超过保留期的投递行，返回删除条数（消息主体不动）。 */
  cleanupExpired(): Promise<number>;
  /**
   * 积分两级通知：按余额所处区间产生至多一条「即将耗尽」/「已耗尽」。
   * 去重与复位纯读推导——最近一条同类通知时刻 vs 账本最近正向流水时刻，
   * 账本不晚于通知即视为仍在同一状态周期内，静默丢弃（见 design.md D6）。
   * 并发下由事务级 advisory lock 串行化该用户的判定与写入（D7）。
   */
  notifyCreditsState(userId: string, balance: number): Promise<CreditsNoticeResult>;
  /** best-effort 包装：失败仅记服务端日志，不向上抛（预检拒绝结果不受影响）。 */
  notifyCreditsStateSafe(userId: string, balance: number): Promise<void>;
}

export interface NotificationsServiceDeps {
  notifications?: NotificationRepo;
  /** 事务执行器：缺省 defaultDb.transaction；单测注入直通以脱离真实库。 */
  runTx?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
  /** 事务内仓储工厂：缺省真实 repo 绑定 tx；单测注入 mock 以断言调用序。 */
  makeTxRepos?: (
    tx: DbClient,
  ) => { notifications: NotificationRepo; ledger: BalanceRecoveryReader };
}

/** 账本读取面（积分通知的复位判据）。 */
export type BalanceRecoveryReader = Pick<
  CreditLedgerRepo,
  "getLatestBalanceRecoveryAt"
>;

export function createNotificationsService(
  deps: NotificationsServiceDeps = {},
): NotificationsService {
  const repo = deps.notifications ?? createNotificationRepo();
  const runTx = deps.runTx ?? ((fn) => defaultDb.transaction(fn));
  const makeTxRepos =
    deps.makeTxRepos ??
    ((tx: DbClient) => ({
      notifications: createNotificationRepo(tx),
      ledger: createCreditLedgerRepo(tx),
    }));

  /**
   * 积分两级通知的判定与写入（3.1/3.2）。定义在工厂作用域而非对象字面量里，
   * 好让 notifyCreditsStateSafe 直接复用同一实现。
   */
  const notifyCreditsState = async (
    userId: string,
    balance: number,
  ): Promise<CreditsNoticeResult> => {
    const category =
      balance <= 0
        ? "credits.exhausted"
        : balance <= CREDITS_LOW_THRESHOLD
          ? "credits.low"
          : null;
    if (!category) return { notified: false, reason: "above_threshold" };
    const notice = CREDITS_NOTICE[category];

    return runTx(async (tx) => {
      // 会话级 advisory lock：把「查最近通知 → 判复位 → 插入」串行化，
      // 消除两个并发请求同时读到「无同类历史」而各插一条的窗口
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

      const txRepos = makeTxRepos(tx);
      const lastNotifiedAt = await txRepos.notifications.findLatestCategoryAt(userId, category);
      if (lastNotifiedAt) {
        const recoveredAt = await txRepos.ledger.getLatestBalanceRecoveryAt(userId);
        // 账本无回升，或回升发生在通知之前 → 仍处于同一状态周期，静默丢弃
        if (!recoveredAt || recoveredAt <= lastNotifiedAt) {
          return { notified: false, reason: "already_notified" };
        }
      }

      await txRepos.notifications.createWithDelivery({
        source: "system",
        category,
        level: notice.level,
        title: notice.title,
        body: notice.body(balance),
        i18nKey: notice.i18nKey,
        i18nParams: { balance },
        audience: "users",
        targetUserIds: [userId],
      });
      return { notified: true, category };
    });
  };

  return {
    async send(input) {
      if (input.source === "admin" && !input.adminId) {
        throw new NotificationError("管理员下发须提供操作者身份", "admin_required");
      }
      // 受众解析在事务外：全体 active 用户查询无需与写入同快照
      const targets =
        input.audience === "all"
          ? await repo.listReceivableUserIds()
          : (input.userIds ?? []);
      if (targets.length === 0) {
        throw new NotificationError(
          input.audience === "all" ? "当前没有可接收的用户" : "定向发送须至少选择一名用户",
          input.audience === "all" ? "no_receivable_user" : "empty_audience",
        );
      }

      const write = async (tx: DbClient) =>
        makeTxRepos(tx).notifications.createWithDelivery({
          source: input.source,
          category: input.category,
          level: input.level,
          title: input.title,
          body: input.body,
          ...(input.i18nKey !== undefined && { i18nKey: input.i18nKey }),
          ...(input.i18nParams !== undefined && { i18nParams: input.i18nParams }),
          audience: input.audience,
          targetUserIds: targets,
          ...(input.adminId !== undefined && { createdBy: input.adminId }),
        });

      // 管理员来源：业务与审计同事务，消除「消息已发但审计缺失」的窗口
      if (input.source === "admin") {
        const created = await withAudit<{ id: string; targetCount: number }>(
          (fn) => runTx(fn),
          (r) => ({
            adminUserId: input.adminId as string,
            action: "message.send",
            targetType: "message",
            targetId: r.id,
            after: {
              category: input.category,
              level: input.level,
              audience: input.audience,
              targetCount: r.targetCount,
            },
            note: input.note,
          }),
          write,
        );
        return { id: created.id, targetCount: created.targetCount };
      }

      const created = await runTx(write);
      return { id: created.id, targetCount: created.targetCount };
    },

    async revoke({ id, adminId, note }) {
      const revokedAt = new Date();
      return withAudit<{ before: Date | null; revokedAt: Date }>(
        (fn) => runTx(fn),
        (r) => ({
          adminUserId: adminId,
          action: "message.revoke",
          targetType: "message",
          targetId: id,
          before: { revokedAt: r.before },
          after: { revokedAt: r.revokedAt },
          note,
        }),
        async (tx) => {
          const txRepo = makeTxRepos(tx).notifications;
          // before 在事务内读取，避免与并发撤回竞态产生失真审计
          const detail = await txRepo.getAdminDetail(id);
          if (!detail) throw new NotificationError("消息不存在", "not_found");
          if (detail.notification.revokedAt) {
            throw new NotificationError("消息已撤回，不可重复撤回", "already_revoked");
          }
          const ok = await txRepo.revoke(id);
          if (!ok) throw new NotificationError("消息已撤回，不可重复撤回", "already_revoked");
          return { before: detail.notification.revokedAt, revokedAt };
        },
      ).then((r) => ({ revokedAt: r.revokedAt }));
    },

    listForUser: (query) => repo.listForUser(query),
    unreadCount: (userId) => repo.countUnread(userId),
    markRead: (userId, notificationId) => repo.markRead(userId, notificationId),
    markAllRead: (userId) => repo.markAllRead(userId),
    listForAdmin: (query) => repo.listForAdmin(query),
    getAdminDetail: (id) => repo.getAdminDetail(id),

    async cleanupExpired() {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      return repo.deleteReadBefore(cutoff);
    },

    notifyCreditsState,

    async notifyCreditsStateSafe(userId, balance) {
      try {
        await notifyCreditsState(userId, balance);
      } catch (err) {
        // best-effort：预检拒绝结果不受通知失败影响，取证走服务端日志
        console.error("[notifications] 积分通知写入失败:", err);
      }
    },
  };
}

/** 进程级单例：web 路由与admin 路由共用同一实例。 */
export const notificationsService: NotificationsService = createNotificationsService();