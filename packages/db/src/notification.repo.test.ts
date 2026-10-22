import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createNotificationRepo } from "./notification.repo";

/**
 * 仓储单测只断言「查询形状 + 调用序 + 扇出批量切分」——mock-db 不执行 SQL，
 * 断不了语义（撤回后过滤、越权读取、清理边界、事务原子性），
 * 那些由 notification.int.test.ts（RUN_PG_TESTS=1）覆盖。
 */

describe("notification repo", () => {
  it("createWithDelivery 先插主记录再按批扇出，返回目标人数", async () => {
    const mock = makeMockDb({
      pendingValues: { id: "n1", source: "admin", audience: "users" },
    });
    const targets = Array.from({ length: 1200 }, (_, i) => `u${i}`);
    const view = await createNotificationRepo(mock.db).createWithDelivery({
      source: "admin",
      category: "admin.broadcast",
      level: "info",
      title: "维护通知",
      body: "今晚 02:00 维护",
      audience: "users",
      targetUserIds: targets,
      createdBy: "admin-1",
    });

    expect(view.targetCount).toBe(1200);
    expect(view.readCount).toBe(0);
    // 1 次主记录 + 3 次扇出（500 + 500 + 200）
    expect(mock.state.calls.map((c) => c.op)).toEqual([
      "insert.values.returning",
      "insert.values",
      "insert.values",
      "insert.values",
    ]);
    // 末批为 200 条；mock 的 returning 回放代码传入的 values（无 DB 生成 id），
    // 故此处只断言批次成员，id 关联由 PG 集成测试覆盖
    const fanoutBatch = mock.state.lastValues as Array<{ userId: string }>;
    expect(fanoutBatch).toHaveLength(200);
    expect(fanoutBatch[0]?.userId).toBe("u1000");
    expect(fanoutBatch.at(-1)?.userId).toBe("u1199");
  });

  it("createWithDelivery 无受众时不发扇出 insert", async () => {
    const mock = makeMockDb({ pendingValues: { id: "n1" } });
    const view = await createNotificationRepo(mock.db).createWithDelivery({
      source: "system",
      category: "credits.low",
      level: "warning",
      title: "积分即将耗尽",
      body: "余额低于预警线",
      i18nKey: "notifications.credits.low",
      i18nParams: { balance: 15 },
      audience: "users",
      targetUserIds: [],
    });
    expect(view.targetCount).toBe(0);
    expect(mock.state.calls.map((c) => c.op)).toEqual(["insert.values.returning"]);
    // 系统消息的 i18n 键与参数随主记录落库（客户端据此渲染词典）
    expect(mock.state.lastValues).toMatchObject({
      i18nKey: "notifications.credits.low",
      i18nParams: { balance: 15 },
    });
  });

  it("listReceivableUserIds 只取 active 用户", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "u1" }, { id: "u2" }] });
    const ids = await createNotificationRepo(mock.db).listReceivableUserIds();
    expect(ids).toEqual(["u1", "u2"]);
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where");
  });

  it("listForUser 先 count 再按 createdAt 倒序分页", async () => {
    const mock = makeMockDb({
      selectQueue: [[{ value: 12 }], [{ id: "n1", readAt: null }]],
    });
    const page = await createNotificationRepo(mock.db).listForUser({
      userId: "u1",
      page: 2,
      pageSize: 10,
    });
    expect(page).toMatchObject({ total: 12, page: 2, pageSize: 10 });
    expect(page.items[0]?.id).toBe("n1");
    expect(mock.state.calls[0]?.op).toBe("select.from.innerJoin.where");
    expect(mock.state.calls.at(-1)?.op).toBe(
      "select.from.innerJoin.where.orderBy.limit.offset",
    );
  });

  it("countUnread 单查询 join 后计数", async () => {
    const mock = makeMockDb({ selectQueue: [[{ value: 2 }]] });
    await expect(createNotificationRepo(mock.db).countUnread("u1")).resolves.toBe(2);
    expect(mock.state.calls).toHaveLength(1);
    expect(mock.state.calls[0]?.op).toBe("select.from.innerJoin.where");
  });

  it("markRead 仅更新未读行并带未撤回存在性子句", async () => {
    const mock = makeMockDb({});
    await expect(
      createNotificationRepo(mock.db).markRead("u1", "n1"),
    ).resolves.toBe(true);
    expect(mock.state.calls.map((c) => c.op)).toEqual(["update.set.where.returning"]);
    expect(mock.state.lastSet).toHaveProperty("readAt");
  });

  it("markAllRead 批量置readAt 并返回条数", async () => {
    const mock = makeMockDb({});
    await expect(createNotificationRepo(mock.db).markAllRead("u1")).resolves.toBe(1);
    expect(mock.state.calls.map((c) => c.op)).toEqual(["update.set.where.returning"]);
    expect(mock.state.lastSet).toHaveProperty("readAt");
  });

  it("listForAdmin 走聚合计数并按 createdAt 倒序分页", async () => {
    const mock = makeMockDb({
      selectQueue: [
        [{ value: 3 }],
        [{ id: "n1", targetCount: 40, readCount: 12 }],
      ],
    });
    const page = await createNotificationRepo(mock.db).listForAdmin({
      page: 1,
      pageSize: 20,
      source: "admin",
      keyword: "维护",
    });
    expect(page.total).toBe(3);
    expect(page.items[0]).toMatchObject({ targetCount: 40, readCount: 12 });
    expect(mock.state.calls[0]?.op).toBe("select.from.where");
    expect(mock.state.calls.at(-1)?.op).toBe(
      "select.from.leftJoin.where.groupBy.orderBy.limit.offset",
    );
  });

  it("getAdminDetail 查主体统计后再查已读明细，不存在返回 null", async () => {
    const mock = makeMockDb({
      selectQueue: [[{ id: "n1", targetCount: 2, readCount: 1 }], []],
    });
    const detail = await createNotificationRepo(mock.db).getAdminDetail("n1");
    expect(detail?.notification.id).toBe("n1");
    expect(detail?.readBy).toEqual([]);
    // 已读行为空时不再查用户资料（users.id 是 uuid，user_id 是 text，不能 join）
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.orderBy");

    const empty = makeMockDb({ selectQueue: [[]] });
    await expect(createNotificationRepo(empty.db).getAdminDetail("nope")).resolves.toBeNull();
  });

  it("getAdminDetail 的已读明细用两次查询 + JS 映射取用户名", async () => {
    const readAt = new Date("2026-10-18T08:30:00.000Z");
    const mock = makeMockDb({
      selectQueue: [
        [{ id: "n1", targetCount: 1, readCount: 1 }],
        [{ userId: "u1", readAt }],
        [{ id: "u1", username: "alice", displayName: "Alice" }],
      ],
    });
    const detail = await createNotificationRepo(mock.db).getAdminDetail("n1");
    expect(detail?.readBy).toEqual([
      { userId: "u1", username: "alice", displayName: "Alice", readAt },
    ]);
    // 明细与资料分两条查：不存在 uuid = text 的无效比较
    expect(mock.state.calls.at(-2)?.op).toBe("select.from.where.orderBy");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where");
  });

  it("revoke 置位 revokedAt", async () => {
    const mock = makeMockDb({});
    await expect(createNotificationRepo(mock.db).revoke("n1")).resolves.toBe(true);
    expect(mock.state.calls.map((c) => c.op)).toEqual(["update.set.where.returning"]);
    expect(mock.state.lastSet).toHaveProperty("revokedAt");
  });

  it("findLatestCategoryAt 按 createdAt 倒序取最近一条", async () => {
    const at = new Date("2026-10-18T00:00:00Z");
    const mock = makeMockDb({ selectQueue: [[{ createdAt: at }]] });
    await expect(
      createNotificationRepo(mock.db).findLatestCategoryAt("u1", "credits.low"),
    ).resolves.toEqual(at);
    expect(mock.state.calls.at(-1)?.op).toBe(
      "select.from.innerJoin.where.orderBy.limit",
    );
  });

  it("deleteReadBefore 只发 delete.where（保留期清理）", async () => {
    const mock = makeMockDb({});
    await createNotificationRepo(mock.db).deleteReadBefore(new Date("2026-07-01"));
    expect(mock.state.calls.map((c) => c.op)).toEqual(["delete.where.returning"]);
  });
});