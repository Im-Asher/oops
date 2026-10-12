import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@oops/db";
import { inviteCodes } from "./schema";
import {
  createInviteCodeRepo,
  deriveInviteStatus,
} from "./invite-code.repo";

/**
 * 真 PG 集成测试：验证 mock 无法覆盖的数据库层语义——
 * 批量生成唯一约束、作废后注册链收口（consumeByCode 条件含 revokedAt IS NULL）、
 * 作废保留原 expiresAt/usedCount、幂等作废。
 * 需要可达的 Postgres：RUN_PG_TESTS=1 + DATABASE_URL 指向真实库（dev: docker oops-postgres）。
 */
const shouldRun = process.env.RUN_PG_TESTS === "1";

describe.skipIf(!shouldRun)("invite-code integration (real PG)", () => {
  const repo = createInviteCodeRepo();
  const generatedIds: string[] = [];

  afterAll(async () => {
    if (generatedIds.length > 0) {
      await db.delete(inviteCodes).where(inArray(inviteCodes.id, generatedIds));
    }
  });

  it("批量生成 50 个码全部唯一且符合字符集", async () => {
    const rows = await repo.generateBatch({ count: 50, note: "int-test" });
    expect(rows).toHaveLength(50);
    generatedIds.push(...rows.map((r) => r.id));
    const codes = new Set(rows.map((r) => r.code));
    expect(codes.size).toBe(50);
    for (const code of codes) {
      expect(code).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    }
  });

  it("作废后 consumeByCode 被拒（注册链收口）且历史用量/有效期保留", async () => {
    const [code] = await repo.generateBatch({
      count: 1,
      maxUses: 5,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      note: "int-test-revoke",
    });
    generatedIds.push(code.id);

    // 作废前可正常消费一次（产生历史用量）
    const consumed = await repo.consumeByCode(code.code);
    expect(consumed).toMatchObject({ usedCount: 1 });

    const revoked = await repo.revoke(code.id);
    expect(revoked).not.toBeNull();
    expect(revoked!.revokedAt).not.toBeNull();
    // 作废保留原值：expiresAt 原样、usedCount 不回退
    expect(revoked!.expiresAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));

    // 注册链收口：已作废码不再可消费（0 行命中）
    await expect(repo.consumeByCode(code.code)).resolves.toBeUndefined();

    const reread = await repo.findById(code.id);
    expect(reread!.usedCount).toBe(1);
    expect(deriveInviteStatus(reread!)).toBe("revoked");
  });

  it("幂等作废：重复 revoke 第二次 0 行命中，首次 revokedAt 不变", async () => {
    const [code] = await repo.generateBatch({ count: 1, note: "int-test-idem" });
    generatedIds.push(code.id);

    const first = await repo.revoke(code.id);
    expect(first).not.toBeNull();
    const firstRevokedAt = first!.revokedAt;

    const second = await repo.revoke(code.id);
    expect(second).toBeUndefined();

    const reread = await repo.findById(code.id);
    expect(reread!.revokedAt).toEqual(firstRevokedAt);
  });

  it("未作废一次性码消费至用尽后拒绝（既有语义回归）", async () => {
    const [code] = await repo.generateBatch({ count: 1, maxUses: 1 });
    generatedIds.push(code.id);

    await expect(repo.consumeByCode(code.code)).resolves.toMatchObject({
      usedCount: 1,
    });
    await expect(repo.consumeByCode(code.code)).resolves.toBeUndefined();
  });
});
