import { desc, eq } from "drizzle-orm";
import { db as defaultDb } from ".";
import { tasks, type Task } from "./schema";

export interface TaskInput {
  type?: "generate_image" | "render_html" | "export";
  payload?: unknown;
  sessionId?: string;
  userId: string;
}

export interface TaskRepo {
  create(input: TaskInput): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  update(
    id: string,
    patch: {
      status?: "pending" | "running" | "succeeded" | "failed" | "canceled";
      result?: unknown;
      error?: string;
    },
  ): Promise<Task | undefined>;
  list(sessionId?: string): Promise<Task[]>;
}

export function createTaskRepo(db: typeof defaultDb = defaultDb): TaskRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(tasks)
        .values({
          type: input.type ?? "generate_image",
          payload: (input.payload as Record<string, unknown>) ?? {},
          sessionId: input.sessionId,
          userId: input.userId,
        })
        .returning();
      return row;
    },

    async get(id) {
      const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return rows[0];
    },

    async update(id, patch) {
      const [row] = await db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();
      return row;
    },

    async list(sessionId) {
      return db
        .select()
        .from(tasks)
        .where(sessionId ? eq(tasks.sessionId, sessionId) : undefined)
        .orderBy(desc(tasks.createdAt))
        .limit(500);
    },
  };
}
