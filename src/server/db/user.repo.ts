import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from ".";
import { users, type User } from "./schema";
import type { DbClient } from "./invite-code.repo";

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
  };
}
