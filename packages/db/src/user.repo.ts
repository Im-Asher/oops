import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db as defaultDb } from ".";
import { users, type User } from "./schema";
import type { DbClient } from "./invite-code.repo";

/** LIKE/ILIKE 通配符转义：用户输入中的 % _ \ 按字面匹配（防搜索语义串扰）。 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

export interface AdminUserQuery {
  /** 用户名 / oops ID / 昵称 模糊匹配（不区分大小写）；空 = 全量列表 */
  search?: string;
  /** 1-based，缺省 1 */
  page?: number;
  /** 缺省 20，上限 100 */
  pageSize?: number;
}

export interface AdminUserPage {
  items: User[];
  total: number;
  page: number;
  pageSize: number;
}

export type UserGender = User["gender"];

export interface CreateUserInput {
  username: string;
  oopsId: string;
  passwordHash: string;
  displayName?: string;
  inviteCodeId?: string;
}

/** 部分更新：仅应用显式提供的字段（value 为 null 表示清除为 NULL） */
export interface ProfilePatch {
  displayName?: string | null;
  gender?: UserGender;
  bio?: string | null;
}

export interface UserRepo {
  findById(id: string): Promise<User | undefined>;
  /** 用户名不区分大小写查找（与 lower(username) 唯一索引配套）。 */
  findByUsername(username: string): Promise<User | undefined>;
  findByOopsId(oopsId: string): Promise<User | undefined>;
  create(input: CreateUserInput): Promise<User>;
  updateProfile(id: string, patch: ProfilePatch): Promise<User | undefined>;
  /** 同一条语句写入新哈希并将 token_version 加一，返回新版本（改密踢下线水位）。 */
  updatePassword(id: string, passwordHash: string): Promise<number | undefined>;
  /** 管理端搜索分页列表（注册时间倒序；含角色/状态/余额/注册时间，均在行内）。 */
  listForAdmin(query: AdminUserQuery): Promise<AdminUserPage>;
  /** 管理端启用/停用（停用即时生效：requireUser 逐请求校验 status）。 */
  setStatus(
    id: string,
    status: User["status"],
  ): Promise<User | undefined>;
}

export function createUserRepo(db: DbClient = defaultDb): UserRepo {
  return {
    async findById(id) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0];
    },

    async findByUsername(username) {
      const rows = await db
        .select()
        .from(users)
        .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
        .limit(1);
      return rows[0];
    },

    async findByOopsId(oopsId) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.oopsId, oopsId))
        .limit(1);
      return rows[0];
    },

    async create(input) {
      const [row] = await db
        .insert(users)
        .values({
          username: input.username,
          oopsId: input.oopsId,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          inviteCodeId: input.inviteCodeId,
        })
        .returning();
      return row;
    },

    async updateProfile(id, patch) {
      const [row] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, id))
        .returning();
      return row;
    },

    async updatePassword(id, passwordHash) {
      const [row] = await db
        .update(users)
        .set({
          passwordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(eq(users.id, id))
        .returning({ tokenVersion: users.tokenVersion });
      return row?.tokenVersion;
    },

    async listForAdmin(query) {
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
      const search = query.search?.trim();
      const where = search
        ? or(
            ilike(users.username, `%${escapeLikePattern(search)}%`),
            ilike(users.oopsId, `%${escapeLikePattern(search)}%`),
            ilike(users.displayName, `%${escapeLikePattern(search)}%`),
          )
        : undefined;

      const [countRow] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(users)
        .where(where);
      const items = await db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { items, total: countRow?.count ?? 0, page, pageSize };
    },

    async setStatus(id, status) {
      const [row] = await db
        .update(users)
        .set({ status })
        .where(eq(users.id, id))
        .returning();
      return row;
    },
  };
}
