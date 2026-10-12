import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
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
  findById(id: string): Promise<InviteCode | undefined>;
  findByCode(code: string): Promise<InviteCode | undefined>;
  /**
   * 条件扣减：仅当码存在、未作废、未过期、未用尽时 used_count+1 并返回该码。
   * 单条 UPDATE 依赖行锁串行化并发注册，0 行命中 = 无效/作废/过期/用尽。
   */
  consumeByCode(code: string): Promise<InviteCode | undefined>;
  /** 批量生成：码由生成器产出并批内去重，唯一性最终由 DB 约束兜底。 */
  generateBatch(
    input: GenerateInviteCodesInput,
    generateCode?: () => string,
  ): Promise<InviteCode[]>;
  /**
   * 作废：仅未作废行写入 revokedAt（保留原 expiresAt/usedCount 语义），
   * 0 行命中 = 不存在或已作废（幂等信号，由调用方区分 404 / 已作废）。
   */
  revoke(id: string): Promise<InviteCode | undefined>;
  /** 管理列表：createdAt 倒序 + 用量/状态派生。 */
  listForAdmin(query: AdminInviteCodeQuery): Promise<AdminInviteCodePage>;
}

export interface GenerateInviteCodesInput {
  /** 1–100 */
  count: number;
  /** 缺省 1（一次性码纪律） */
  maxUses?: number;
  /** 缺省 null（永久有效） */
  expiresAt?: Date | null;
  note?: string | null;
}

export type InviteCodeDerivedStatus =
  | "active"
  | "exhausted"
  | "expired"
  | "revoked";

export type InviteCodeWithStatus = InviteCode & {
  status: InviteCodeDerivedStatus;
};

export interface AdminInviteCodeQuery {
  page?: number;
  pageSize?: number;
}

export interface AdminInviteCodePage {
  items: InviteCodeWithStatus[];
  total: number;
  page: number;
  pageSize: number;
}

export function deriveInviteStatus(
  row: InviteCode,
  now = new Date(),
): InviteCodeDerivedStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.usedCount >= row.maxUses) return "exhausted";
  return "active";
}

// —— 码生成（与 oops-id 同惯例：8 位去易混字符）——
export const INVITE_CODE_LENGTH = 8;
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_ALPHABET_SIZE = CODE_ALPHABET.length;
/** 拒采样上限（31 的最大整数倍 ≤ 256），避免取模偏差 */
const CODE_REJECT_ABOVE = Math.floor(256 / CODE_ALPHABET_SIZE) * CODE_ALPHABET_SIZE;

export function generateInviteCode(): string {
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    const bytes = randomBytes(INVITE_CODE_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= CODE_REJECT_ABOVE) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET_SIZE];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }
  return code;
}

/** 批内去重的尝试上限：真实生成器碰撞概率约 31^-8，此上限只为防注入的退化生成器死循环。 */
const GENERATE_ATTEMPT_LIMIT = 1000;

export function createInviteCodeRepo(db: DbClient = defaultDb): InviteCodeRepo {
  return {
    async findById(id) {
      const rows = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.id, id))
        .limit(1);
      return rows[0];
    },

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
            isNull(inviteCodes.revokedAt),
            lt(inviteCodes.usedCount, inviteCodes.maxUses),
            or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
          ),
        )
        .returning();
      return rows[0];
    },

    async generateBatch(input, generateCode = generateInviteCode) {
      const count = Math.max(1, Math.min(100, input.count));
      const seen = new Set<string>();
      let attempts = 0;
      while (seen.size < count) {
        if (++attempts > GENERATE_ATTEMPT_LIMIT) {
          throw new Error("invite code generation exhausted retries");
        }
        seen.add(generateCode());
      }
      return db
        .insert(inviteCodes)
        .values(
          [...seen].map((code) => ({
            code,
            maxUses: input.maxUses ?? 1,
            expiresAt: input.expiresAt ?? null,
            note: input.note ?? null,
          })),
        )
        .returning();
    },

    async revoke(id) {
      const rows = await db
        .update(inviteCodes)
        .set({ revokedAt: new Date() })
        .where(and(eq(inviteCodes.id, id), isNull(inviteCodes.revokedAt)))
        .returning();
      return rows[0];
    },

    async listForAdmin(query) {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
      const [countRow] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(inviteCodes);
      const rows = await db
        .select()
        .from(inviteCodes)
        .orderBy(desc(inviteCodes.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((row) => ({ ...row, status: deriveInviteStatus(row) })),
        total: countRow?.count ?? 0,
        page,
        pageSize,
      };
    },
  };
}
