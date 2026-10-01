import { eq, sql } from "drizzle-orm";
import { db as defaultDb } from ".";
import { users, type User } from "./schema";
import type { DbClient } from "./invite-code.repo";

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  displayName?: string;
  inviteCodeId?: string;
}

export interface UserRepo {
  findById(id: string): Promise<User | undefined>;
  /** 用户名不区分大小写查找（与 lower(username) 唯一索引配套）。 */
  findByUsername(username: string): Promise<User | undefined>;
  create(input: CreateUserInput): Promise<User>;
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

    async create(input) {
      const [row] = await db
        .insert(users)
        .values({
          username: input.username,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          inviteCodeId: input.inviteCodeId,
        })
        .returning();
      return row;
    },
  };
}
