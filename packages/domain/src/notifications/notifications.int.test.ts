import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@oops/db";
import { createCreditLedgerRepo } from "@oops/db/credit-ledger.repo";
import { createNotificationRepo } from "@oops/db/notification.repo";
import {
  adminAuditLog,
  creditLedger,
  notifications,
  userNotifications,
  users,
} from "@oops/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createNotificationsService, NotificationError } from "./service";

/**
 * 真 PG 集成测试：验证 mock-db 断不了的数据库层语义——
 * 写时扇出与主记录的事务原子性、advisory lock 下的并发去重、撤回过滤、保留期清理边界、越权读取。
 * 需要可达的 Postgres：RUN_PG_TESTS=1 + DATABASE_URL 指向真实库（dev: docker oops-postgres）。
 */
const shouldRun = process.env.RUN_PG_TESTS === "1";

describe.skipIf(!shouldRun)("notifications integration (real PG)", () => {
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const repo = createNotificationRepo();
  const service = createNotificationsService();

  beforeAll(async () => {
    await db.insert(users).values(
      [userA, userB].map((id) => ({
        id,
        username: `notif-int-${id.slice(0, 8)}`,
        oopsId: id.replaceAll("-", "").slice(0, 8),
        passwordHash: "x",
        displayName: null,
        creditBalance: 0,
      })),
    );
  });

  beforeEach(async () => {
    // 每个用例从干净的通知表开始，避免去重判据被前一个用例污染
    await db.delete(userNotifications);
    await db.delete(notifications);
  });

  afterAll(async () => {
    await db.delete(userNotifications).where(inArray(userNotifications.userId, [userA, userB]));
    await db.delete(notifications);
    await db.delete(adminAuditLog).where(eq(adminAuditLog.adminUserId, adminId));
    await db.delete(creditLedger).where(inArray(creditLedger.userId, [userA, userB]));
    await db.delete(users).where(inArray(users.id, [userA, userB]));
  });

  /** 建一条投递给 userA 的消息（管理员来源，顺带落 message.send 审计）。 */
  async function sendToA(title = "定向给 A") {
    return service.send({
      source: "admin",
      category: "admin.direct",
      level: "info",
      title,
      body: "只有 A",
      audience: "users",
      userIds: [userA],
      adminId,
    });
  }

  it("扇出与主记录同事务：目标 2 人时投递行恰好 2 行", async () => {
    const view = await repo.createWithDelivery({
      source: "admin",
      category: "admin.direct",
      level: "info",
      title: "定向",
      body: "只有你",
      audience: "users",
      targetUserIds: [userA, userB],
      createdBy: adminId,
    });

    const rows = await db.select().from(userNotifications);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([userA, userB].sort());
    expect(view.targetCount).toBe(2);
  });

  it("事务原子性：投递后事务失败时主记录与投递行都不残留", async () => {
    await expect(
      db.transaction(async (tx) => {
        // 事务内直接用绑定 tx 的仓储：随后主动抛错，验证外层回滚不留部分投递
        await createNotificationRepo(tx).createWithDelivery({
          source: "admin",
          category: "admin.broadcast",
          level: "info",
          title: "会回滚",
          body: "x",
          audience: "users",
          targetUserIds: [userA, userB],
          createdBy: adminId,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.select().from(userNotifications)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("撤回过滤：撤回后用户侧列表查不到，投递行与统计仍在", async () => {
    const sent = await sendToA();
    expect((await repo.listForUser({ userId: userA, page: 1, pageSize: 20 })).total).toBe(1);

    await service.revoke({ id: sent.id, adminId, note: "撤回" });

    expect((await repo.listForUser({ userId: userA, page: 1, pageSize: 20 })).total).toBe(0);
    // 投递行保留，管理端仍能回答「撤回前多少人读过」（D4）
    expect(await db.select().from(userNotifications)).toHaveLength(1);
    const detail = await repo.getAdminDetail(sent.id);
    expect(detail?.notification.revokedAt).toBeTruthy();
    expect(detail?.notification.targetCount).toBe(1);
  });

  it("重复撤回被拒且状态不变", async () => {
    const sent = await sendToA();
    await service.revoke({ id: sent.id, adminId });
    const first = (await repo.getAdminDetail(sent.id))?.notification.revokedAt;
    await expect(service.revoke({ id: sent.id, adminId })).rejects.toBeInstanceOf(NotificationError);
    const second = (await repo.getAdminDetail(sent.id))?.notification.revokedAt;
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it("advisory lock 并发去重：同一用户 5 次并发耗尽通知只产生 1 条", async () => {
    await db.update(users).set({ creditBalance: 0 }).where(eq(users.id, userA));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.notifyCreditsState(userA, 0)),
    );
    const notified = results.filter((r) => r.notified);
    expect(notified).toHaveLength(1);
    expect(notified[0].category).toBe("credits.exhausted");
    expect(await db.select().from(userNotifications)).toHaveLength(1);
    await expect(repo.countUnread(userA)).resolves.toBe(1);
  });

  it("复位判定：未回升静默丢弃，余额回升后可再发", async () => {
    await db.update(users).set({ creditBalance: 0 }).where(eq(users.id, userA));
    expect((await service.notifyCreditsState(userA, 0)).notified).toBe(true);
    expect((await service.notifyCreditsState(userA, 0)).notified).toBe(false);

    // 回升：一条晚于通知的正向流水
    await createCreditLedgerRepo().adjust({
      userId: userA,
      amount: 50,
      type: "grant",
      note: "回升",
    });
    expect((await service.notifyCreditsState(userA, 0)).notified).toBe(true);
    expect(await db.select().from(userNotifications)).toHaveLength(2);
  });

  it("预警线只在结算后复查：余额为正且 ≤ 预警线时发 credits.low", async () => {
    await db.update(users).set({ creditBalance: 0 }).where(eq(users.id, userA));
    expect(await service.notifyCreditsState(userA, 21)).toMatchObject({
      notified: false,
      reason: "above_threshold",
    });
    expect(await service.notifyCreditsState(userA, 20)).toMatchObject({
      category: "credits.low",
      notified: true,
    });
  });

  it("保留期清理：只删已读且早于水位的投递行，消息主体与未读行不动", async () => {
    const sent = await sendToA();
    // 未读行 + 一条回拨到 100 天前的已读行（第二次发送制造）
    await service.send({
      source: "admin",
      category: "admin.direct",
      level: "info",
      title: "第二条",
      body: "也只给 A",
      audience: "users",
      userIds: [userA],
      adminId,
    });
    await db
      .update(userNotifications)
      .set({ readAt: new Date(Date.now() - 100 * 24 * 3600 * 1000) })
      .where(eq(userNotifications.notificationId, sent.id));
    expect(await db.select().from(userNotifications)).toHaveLength(2);

    const deleted = await repo.deleteReadBefore(new Date(Date.now() - 90 * 24 * 3600 * 1000));
    expect(deleted).toBe(1);
    expect(await db.select().from(userNotifications)).toHaveLength(1);
    // 消息主体不动：管理端仍可查历史统计
    expect(await db.select().from(notifications)).toHaveLength(2);
  });

  it("越权读取：他人消息不出现，且 markRead 对非投递者返回 false", async () => {
    const sent = await sendToA();
    expect((await repo.listForUser({ userId: userB, page: 1, pageSize: 20 })).total).toBe(0);
    await expect(repo.markRead(userB, sent.id)).resolves.toBe(false);
    await expect(repo.markRead(userA, sent.id)).resolves.toBe(true);
  });

  it("全部已读：计数归零但消息与投递行保留", async () => {
    await repo.createWithDelivery({
      source: "admin",
      category: "admin.broadcast",
      level: "info",
      title: "广播",
      body: "全员",
      audience: "users",
      targetUserIds: [userA, userB],
      createdBy: adminId,
    });
    await expect(repo.countUnread(userA)).resolves.toBe(1);
    await expect(repo.markAllRead(userA)).resolves.toBe(1);
    await expect(repo.countUnread(userA)).resolves.toBe(0);
    expect(await db.select().from(userNotifications)).toHaveLength(2);
  });

  it("审计与业务同事务：管理员来源落 message.send 审计", async () => {
    const sent = await sendToA("带审计");
    const rows = await db.select().from(adminAuditLog);
    const entry = rows.find((r) => r.targetId === sent.id);
    expect(entry?.action).toBe("message.send");
    expect(entry?.targetType).toBe("message");
    expect(entry?.adminUserId).toBe(adminId);
  });
});
