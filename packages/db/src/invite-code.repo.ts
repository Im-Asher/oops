import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db as defaultDb } from ".";
import { inviteCodes, type InviteCode } from "./schema";

/** 事务句柄与普通 client 的结构并集：注册流程需要在同一事务内跨仓储操作。 */
type SchemaModule = typeof import("./schema");
export type DbClient =
  | typeof defaultDb
  | PgTransaction<NodePgQueryResultHKT, SchemaModule, ExtractTablesWithRelations<SchemaModule>>;

export interface InviteCodeRepo {
  findByCode(code: string): Promise<InviteCode | undefined>;
  /**
   * 条件扣减：仅当码存在、未过期、未用尽时 used_count+1 并返回该码。
   * 单条 UPDATE 依赖行锁串行化并发注册，0 行命中 = 无效/过期/用尽。
   */
  consumeByCode(code: string): Promise<InviteCode | undefined>;
}

export function createInviteCodeRepo(db: DbClient = defaultDb): InviteCodeRepo {
  return {
    async findByCode(code) {
      const rows = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, code))
        .limit(1);
      return rows[0];
    },

    async consumeByCode(code) {
      const rows = await db
        .update(inviteCodes)
        .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
        .where(
          and(
            eq(inviteCodes.code, code),
            lt(inviteCodes.usedCount, inviteCodes.maxUses),
            or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
          ),
        )
        .returning();
      return rows[0];
    },
  };
}
