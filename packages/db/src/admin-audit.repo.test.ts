import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  createAdminAuditRepo,
  withAudit,
} from "./admin-audit.repo";
import { makeMockDb } from "./mock-db";

describe("admin audit repo", () => {
  it("record inserts structured before/after and returns the row", async () => {
    const mock = makeMockDb();
    const before = { status: "active" };
    const after = { status: "disabled" };
    const row = await createAdminAuditRepo(mock.db).record({
      adminUserId: "admin1",
      action: "user.status_change",
      targetType: "user",
      targetId: "u1",
      before,
      after,
      note: "违规账号",
    });
    expect(row).toMatchObject({ adminUserId: "admin1", action: "user.status_change" });
    expect(mock.state.lastValues).toMatchObject({ before, after, note: "违规账号" });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("record with minimal input omits optional keys entirely", async () => {
    const mock = makeMockDb();
    await createAdminAuditRepo(mock.db).record({
      adminUserId: "admin1",
      action: "invite.create",
      targetType: "invite_code",
    });
    expect(mock.state.lastValues).toEqual({
      adminUserId: "admin1",
      action: "invite.create",
      targetType: "invite_code",
    });
  });

  it("record rejects unknown action or target type", async () => {
    const mock = makeMockDb();
    const repo = createAdminAuditRepo(mock.db);
    await expect(
      repo.record({
        adminUserId: "admin1",
        action: "hacker.backdoor" as never,
        targetType: "user",
      }),
    ).rejects.toThrow("未知审计动作");
    await expect(
      repo.record({
        adminUserId: "admin1",
        action: "user.status_change",
        targetType: "secret_table" as never,
      }),
    ).rejects.toThrow("未知审计对象类型");
  });

  it("action and target type constant sets are complete", () => {
    expect([...ADMIN_AUDIT_ACTIONS]).toEqual([
      "user.status_change",
      "invite.create",
      "invite.revoke",
      "credits.adjust",
      "pricing.update",
      "agent.toggle",
      "model.config",
    ]);
    expect([...ADMIN_AUDIT_TARGET_TYPES]).toEqual([
      "user",
      "invite_code",
      "credit_price",
      "agent",
      "model_config",
    ]);
  });

  it("list queries count first then paged rows in createdAt desc order", async () => {
    const mock = makeMockDb({
      selectResult: [{ count: 7 }, { id: "a1" }],
    });
    const page = await createAdminAuditRepo(mock.db).list({
      action: "credits.adjust",
      page: 2,
      pageSize: 5,
    });
    expect(page.total).toBe(7);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(5);
    expect(mock.state.calls[0]?.op).toBe("select.from.where");
    expect(mock.state.calls.at(-1)?.op).toBe("select.from.where.orderBy.limit.offset");
  });

  it("withAudit writes the audit row in the same tx after biz succeeds", async () => {
    const txMock = makeMockDb();
    const order: string[] = [];
    const result = await withAudit(
      (fn) => fn(txMock.db),
      (r: { balanceBefore: number }) => ({
        adminUserId: "admin1",
        action: "credits.adjust" as const,
        targetType: "user" as const,
        targetId: "u1",
        before: { balance: r.balanceBefore },
        after: { balance: r.balanceBefore + 50 },
      }),
      async () => {
        order.push("biz");
        return { balanceBefore: 100 };
      },
    );
    expect(result).toEqual({ balanceBefore: 100 });
    expect(order).toEqual(["biz"]);
    // 同事务：业务执行后紧跟一次审计 insert，且 audit 输入复用了 biz 返回值
    expect(txMock.state.calls.some((c) => c.op.startsWith("insert"))).toBe(true);
    expect(txMock.state.lastValues).toMatchObject({
      action: "credits.adjust",
      before: { balance: 100 },
      after: { balance: 150 },
    });
  });

  it("withAudit does not write audit when biz fails (tx rolls back)", async () => {
    const mock = makeMockDb();
    await expect(
      withAudit(
        (fn) => fn(mock.db),
        {
          adminUserId: "admin1",
          action: "user.status_change",
          targetType: "user",
        },
        async () => {
          throw new Error("biz exploded");
        },
      ),
    ).rejects.toThrow("biz exploded");
    // 失败尝试不产生任何 insert——真实事务中审计行随业务一起回滚
    expect(mock.state.calls.some((c) => c.op.startsWith("insert"))).toBe(false);
  });
});
