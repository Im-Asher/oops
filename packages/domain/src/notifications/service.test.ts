import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { makeMockDb } from "@oops/db/mock-db";
import type {
  AdminNotificationView,
  NotificationRepo,
} from "@oops/db/notification.repo";
import {
  CREDITS_LOW_THRESHOLD,
  createNotificationsService,
  NotificationError,
  RETENTION_DAYS,
} from "./service";

type MockRepo = {
  [K in keyof NotificationRepo]: ReturnType<typeof vi.fn>;
};

function makeRepo(overrides: Partial<Record<keyof NotificationRepo, unknown>> = {}) {
  const repo = {
    createWithDelivery: vi.fn(async (input) => ({
      id: "n1",
      targetCount: input.targetUserIds.length,
      readCount: 0,
    })),
    listReceivableUserIds: vi.fn(async () => ["u1", "u2"]),
    listForUser: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    countUnread: vi.fn(async () => 0),
    markRead: vi.fn(async () => true),
    markAllRead: vi.fn(async () => 0),
    listForAdmin: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getAdminDetail: vi.fn(async (): Promise<{
      notification: AdminNotificationView;
      readBy: unknown[];
    } | null> => null),
    revoke: vi.fn(async () => true),
    findLatestCategoryAt: vi.fn(async () => null),
    deleteReadBefore: vi.fn(async () => 0),
    ...overrides,
  } as unknown as MockRepo;
  return repo;
}

const adminInput = {
  source: "admin" as const,
  category: "admin.broadcast" as const,
  level: "info" as const,
  title: "维护通知",
  body: "今晚 02:00 维护",
  adminId: "admin-1",
};

describe("notifications service", () => {
  let mock: ReturnType<typeof makeMockDb>;
  let repo: MockRepo;
  let ledger: {
    getLatestBalanceRecoveryAt: Mock<(userId: string) => Promise<Date | null>>;
  };

  const makeSvc = (overrides: Partial<Record<keyof NotificationRepo, unknown>> = {}) => {
    repo = makeRepo(overrides);
    ledger = { getLatestBalanceRecoveryAt: vi.fn(async (_userId: string) => null as Date | null) };
    mock = makeMockDb({ pendingValues: { id: "n1", adminUserId: "admin-1" } });
    return createNotificationsService({
      notifications: repo as unknown as NotificationRepo,
      runTx: (fn) => fn(mock.db),
      makeTxRepos: () => ({
        notifications: repo as unknown as NotificationRepo,
        ledger,
      }),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("send", () => {
    it("全体受众解析为全部可接收用户，并与审计同事务", async () => {
      const svc = makeSvc();
      const result = await svc.send({ ...adminInput, audience: "all" });

      expect(repo.listReceivableUserIds).toHaveBeenCalled();
      expect(repo.createWithDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ audience: "all", targetUserIds: ["u1", "u2"], createdBy: "admin-1" }),
      );
      expect(result).toEqual({ id: "n1", targetCount: 2 });
      // 审计是最后一次写入：message.send / message 目标类型
      // （drizzle.values() 收到的是 camelCase 键，列名映射发生在 SQL 层）
      expect(mock.state.lastValues).toMatchObject({
        adminUserId: "admin-1",
        action: "message.send",
        targetType: "message",
        targetId: "n1",
      });
    });

    it("定向受众未选人时拒绝且不产生任何写入", async () => {
      const svc = makeSvc();
      await expect(
        svc.send({ ...adminInput, audience: "users", userIds: [] }),
      ).rejects.toMatchObject({ name: "NotificationError", kind: "empty_audience" });
      expect(repo.createWithDelivery).not.toHaveBeenCalled();
      expect(mock.state.calls).toHaveLength(0);
    });

    it("全体受众但无可接收用户时以 no_receivable_user 拒绝", async () => {
      const svc = makeSvc({ listReceivableUserIds: vi.fn(async () => []) });
      await expect(svc.send({ ...adminInput, audience: "all" })).rejects.toMatchObject({
        kind: "no_receivable_user",
      });
    });

    it("管理员来源缺操作者身份时拒绝", async () => {
      const svc = makeSvc();
      const { adminId: _omit, ...noAdmin } = adminInput;
      await expect(
        svc.send({ ...noAdmin, audience: "all" }),
      ).rejects.toBeInstanceOf(NotificationError);
      expect(repo.createWithDelivery).not.toHaveBeenCalled();
    });

    it("系统消息不落审计（无操作者），只写业务", async () => {
      const svc = makeSvc();
      await svc.send({
        source: "system",
        category: "credits.low",
        level: "warning",
        title: "积分即将耗尽",
        body: "余额低于预警线",
        i18nKey: "notifications.credits.low",
        i18nParams: { balance: 15 },
        audience: "users",
        userIds: ["u1"],
      });
      // 主记录 + 1 次扇出，无审计写入
      expect(repo.createWithDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ i18nKey: "notifications.credits.low", targetUserIds: ["u1"] }),
      );
      // 仓储已被 mock，mock.db 只记录审计写入：系统消息无操作者 → 无任何 db 调用
      expect(mock.state.calls).toHaveLength(0);
    });
  });

  describe("revoke", () => {
    const detail = (revokedAt: Date | null) => ({
      notification: { id: "n1", revokedAt } as AdminNotificationView,
      readBy: [],
    });

    it("置位撤回并落审计（含前后状态）", async () => {
      const svc = makeSvc({ getAdminDetail: vi.fn(async () => detail(null)) });
      const result = await svc.revoke({ id: "n1", adminId: "admin-1" });

      expect(repo.revoke).toHaveBeenCalledWith("n1");
      expect(result.revokedAt).toBeInstanceOf(Date);
      expect(mock.state.lastValues).toMatchObject({
        action: "message.revoke",
        targetType: "message",
        before: { revokedAt: null },
      });
    });

    it("重复撤回被拒且不落审计", async () => {
      const svc = makeSvc({
        getAdminDetail: vi.fn(async () => detail(new Date("2026-10-01"))),
      });
      await expect(svc.revoke({ id: "n1", adminId: "admin-1" })).rejects.toMatchObject({
        kind: "already_revoked",
      });
      expect(repo.revoke).not.toHaveBeenCalled();
      // bizFn 抛错 → withAudit 不写审计（仓储为 mock，db 层零调用）
      expect(mock.state.calls).toHaveLength(0);
    });

    it("消息不存在时以 not_found 拒绝", async () => {
      const svc = makeSvc({ getAdminDetail: vi.fn(async () => null) });
      await expect(svc.revoke({ id: "nope", adminId: "admin-1" })).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });

  describe("查询门面", () => {
    it("用户侧与管理端查询均透传到仓储", async () => {
      const svc = makeSvc();
      await svc.listForUser({ userId: "u1", page: 1, pageSize: 20 });
      await svc.unreadCount("u1");
      await svc.markRead("u1", "n1");
      await svc.markAllRead("u1");
      await svc.listForAdmin({ page: 1, pageSize: 20 });
      await svc.getAdminDetail("n1");

      expect(repo.listForUser).toHaveBeenCalledWith({ userId: "u1", page: 1, pageSize: 20 });
      expect(repo.countUnread).toHaveBeenCalledWith("u1");
      expect(repo.markRead).toHaveBeenCalledWith("u1", "n1");
      expect(repo.markAllRead).toHaveBeenCalledWith("u1");
      expect(repo.listForAdmin).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
      expect(repo.getAdminDetail).toHaveBeenCalledWith("n1");
    });

    it("markRead 的 false 语义透传（路由层据此回 404）", async () => {
      const svc = makeSvc({ markRead: vi.fn(async () => false) });
      await expect(svc.markRead("u1", "nope")).resolves.toBe(false);
    });
  });

  describe("cleanupExpired", () => {
    it("按 90 天保留期计算清理水位", async () => {
      const svc = makeSvc();
      const before = Date.now();
      await svc.cleanupExpired();
      const cutoff = repo.deleteReadBefore.mock.calls[0]?.[0] as Date;
      const expected = before - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThan(expected - 5_000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(expected + 5_000);
    });
  });

  describe("notifyCreditsState（两级阈值 + 去重复位）", () => {
    it("高于预警线不通知", async () => {
      const svc = makeSvc();
      await expect(svc.notifyCreditsState("u1", CREDITS_LOW_THRESHOLD + 10)).resolves.toEqual({
        notified: false,
        reason: "above_threshold",
      });
      expect(repo.createWithDelivery).not.toHaveBeenCalled();
    });

    it("归零发耗尽通知（critical + 词典键 + 余额参数）", async () => {
      const svc = makeSvc();
      await expect(svc.notifyCreditsState("u1", 0)).resolves.toEqual({
        notified: true,
        category: "credits.exhausted",
      });
      expect(repo.createWithDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "system",
          category: "credits.exhausted",
          level: "critical",
          i18nKey: "notifications.credits.exhausted",
          i18nParams: { balance: 0 },
          audience: "users",
          targetUserIds: ["u1"],
        }),
      );
    });

    it("跌破预警线但仍为正发预警通知（warning）", async () => {
      const svc = makeSvc();
      await expect(svc.notifyCreditsState("u1", CREDITS_LOW_THRESHOLD - 5)).resolves.toEqual({
        notified: true,
        category: "credits.low",
      });
      expect(repo.createWithDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ level: "warning", i18nKey: "notifications.credits.low" }),
      );
    });

    it("已有同类通知且账本无回升 → 静默丢弃不重复发", async () => {
      const svc = makeSvc({
        findLatestCategoryAt: vi.fn(async () => new Date("2026-10-18T00:00:00Z")),
      });
      await expect(svc.notifyCreditsState("u1", 0)).resolves.toEqual({
        notified: false,
        reason: "already_notified",
      });
      expect(repo.createWithDelivery).not.toHaveBeenCalled();
    });

    it("账本回升晚于最近通知 → 允许再次通知", async () => {
      const svc = makeSvc({
        findLatestCategoryAt: vi.fn(async () => new Date("2026-10-18T00:00:00Z")),
      });
      ledger.getLatestBalanceRecoveryAt.mockResolvedValue(new Date("2026-10-18T06:00:00Z"));
      await expect(svc.notifyCreditsState("u1", 0)).resolves.toEqual({
        notified: true,
        category: "credits.exhausted",
      });
      expect(repo.createWithDelivery).toHaveBeenCalled();
    });

    it("账本回升早于最近通知 → 仍在同一周期，丢弃", async () => {
      const svc = makeSvc({
        findLatestCategoryAt: vi.fn(async () => new Date("2026-10-18T06:00:00Z")),
      });
      ledger.getLatestBalanceRecoveryAt.mockResolvedValue(new Date("2026-10-18T00:00:00Z"));
      await expect(svc.notifyCreditsState("u1", 0)).resolves.toEqual({
        notified: false,
        reason: "already_notified",
      });
      expect(repo.createWithDelivery).not.toHaveBeenCalled();
    });

    it("判定前先取会话级 advisory lock", async () => {
      const svc = makeSvc();
      await svc.notifyCreditsState("u1", 0);
      expect(mock.state.calls[0]?.op).toBe("execute");
    });

    it("Safe 包装吞掉异常只记日志", async () => {
      const svc = makeSvc();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      repo.findLatestCategoryAt.mockRejectedValueOnce(new Error("db down"));
      await expect(svc.notifyCreditsStateSafe("u1", 0)).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});