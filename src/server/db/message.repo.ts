import { asc, eq } from "drizzle-orm";
import { db as defaultDb } from ".";
import { messages, type Message } from "./schema";
import { OWNER_ID } from "@/lib/config";

export interface MessageInput {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content?: string;
  toolCalls?: unknown;
  // LLM 视图 transcript（pi-ai Message 序列，写入前须经清洗：无 thinking、无 base64）
  transcript?: unknown;
  userId?: string;
}

export interface MessageRepo {
  create(input: MessageInput): Promise<Message>;
  list(sessionId: string): Promise<Message[]>;
  remove(id: string): Promise<void>;
}

export function createMessageRepo(db: typeof defaultDb = defaultDb): MessageRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(messages)
        .values({
          sessionId: input.sessionId,
          role: input.role,
          content: input.content ?? "",
          toolCalls: input.toolCalls,
          transcript: input.transcript,
          userId: input.userId ?? OWNER_ID,
        })
        .returning();
      return row;
    },

    async list(sessionId) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.createdAt))
        .limit(1000);
    },

    async remove(id) {
      await db.delete(messages).where(eq(messages.id, id));
    },
  };
}
