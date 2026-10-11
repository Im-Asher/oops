import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from ".";
import { sessions, type Session } from "./schema";

export interface SessionRepo {
  create(input: { title?: string; agentId?: string; userId: string }): Promise<Session>;
  list(userId: string): Promise<Session[]>;
  get(id: string, userId: string): Promise<Session | undefined>;
  rename(id: string, title: string): Promise<Session | undefined>;
  /** 重绑会话 Agent（composer 切换后下一轮生效）。 */
  updateAgent(id: string, agentId: string): Promise<Session | undefined>;
  // compact 产物落库；水位线单调性由调用方（compact 模块）基于消息列表位置保证
  updateSummary(
    id: string,
    input: { summary: string; summarizedUpTo: string | null },
  ): Promise<Session | undefined>;
  remove(id: string): Promise<void>;
}

export function createSessionRepo(db: typeof defaultDb = defaultDb): SessionRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(sessions)
        .values({
          title: input.title,
          agentId: input.agentId,
          userId: input.userId,
        })
        .returning();
      return row;
    },

    async list(userId) {
      return db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId))
        .orderBy(desc(sessions.updatedAt))
        .limit(100);
    },

    async get(id, userId) {
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

    async updateAgent(id, agentId) {
      const [row] = await db
        .update(sessions)
        .set({ agentId, updatedAt: new Date() })
        .where(eq(sessions.id, id))
        .returning();
      return row;
    },

    async updateSummary(id, input) {
      const [row] = await db
        .update(sessions)
        .set({
          summary: input.summary,
          summarizedUpTo: input.summarizedUpTo,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, id))
        .returning();
      return row;
    },

    async remove(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
  };
}
