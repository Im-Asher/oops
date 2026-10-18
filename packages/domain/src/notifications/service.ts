import { db as defaultDb } from "@oops/db";
import { withAudit } from "@oops/db/admin-audit.repo";
import type { DbClient } from "@oops/db/credit-ledger.repo";
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
}

export interface NotificationsServiceDeps {
  notifications?: NotificationRepo;
  /** 事务执行器：缺省 defaultDb.transaction；单测注入直通以脱离真实库。 */
  runTx?: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
  /** 事务内仓储工厂：缺省真实 repo 绑定 tx；单测注入 mock 以断言调用序。 */
  makeTxRepos?: (tx: DbClient) => { notifications: NotificationRepo };
}

export function createNotificationsService(
  deps: NotificationsServiceDeps = {},
): NotificationsService {
  const repo = deps.notifications ?? createNotificationRepo();
  const runTx = deps.runTx ?? ((fn) => defaultDb.transaction(fn));
  const makeTxRepos =
    deps.makeTxRepos ??
    ((tx: DbClient) => ({ notifications: createNotificationRepo(tx) }));

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
  };
}

/** 进程级单例：web 路由与admin 路由共用同一实例。 */
export const notificationsService: NotificationsService = createNotificationsService();