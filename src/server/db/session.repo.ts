import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from ".";
import { sessions, type Session } from "./schema";
import { OWNER_ID } from "@/lib/config";

export interface SessionRepo {
  create(input?: { title?: string; agentId?: string; userId?: string }): Promise<Session>;
  list(userId?: string): Promise<Session[]>;
  get(id: string, userId?: string): Promise<Session | undefined>;
  rename(id: string, title: string): Promise<Session | undefined>;
  remove(id: string): Promise<void>;
}

export function createSessionRepo(db: typeof defaultDb = defaultDb): SessionRepo {
  return {
    async create(input = {}) {
      const [row] = await db
        .insert(sessions)
        .values({
          title: input.title,
          agentId: input.agentId,
          userId: input.userId ?? OWNER_ID,
        })
        .returning();
      return row;
    },

    async list(userId = OWNER_ID) {
      return db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.updatedAt))
        .limit(100);
    },

    async get(id, userId = OWNER_ID) {
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
        .limit(1);
      return rows[0];
    },

    async rename(id, title) {
      const [row] = await db
        .update(sessions)
        .set({ title, updatedAt: new Date() })
        .where(eq(sessions.id, id))
        .returning();
      return row;
    },

    async remove(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
  };
}
