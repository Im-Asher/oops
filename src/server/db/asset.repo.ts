import { desc, eq } from "drizzle-orm";
import { db as defaultDb } from ".";
import { assets, type Asset } from "./schema";
import { OWNER_ID } from "@/lib/config";

export interface AssetInput {
  storageKey: string;
  mimeType: string;
  sessionId?: string;
  kind?: "image" | "json" | "other";
  width?: number;
  height?: number;
  prompt?: string;
  model?: string;
  sourceUrl?: string;
  meta?: unknown;
  userId?: string;
}

export interface AssetRepo {
  create(input: AssetInput): Promise<Asset>;
  get(id: string): Promise<Asset | undefined>;
  list(sessionId?: string): Promise<Asset[]>;
  remove(id: string): Promise<void>;
}

export function createAssetRepo(db: typeof defaultDb = defaultDb): AssetRepo {
  return {
    async create(input) {
      const [row] = await db
        .insert(assets)
        .values({
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sessionId: input.sessionId,
          kind: input.kind ?? "image",
          width: input.width,
          height: input.height,
          prompt: input.prompt,
          model: input.model,
          sourceUrl: input.sourceUrl,
          meta: (input.meta as Record<string, unknown>) ?? {},
          userId: input.userId ?? OWNER_ID,
        })
        .returning();
      return row;
    },

    async get(id) {
      const rows = await db
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .limit(1);
      return rows[0];
    },

    async list(sessionId) {
      return db
        .select()
        .from(assets)
        .where(sessionId ? eq(assets.sessionId, sessionId) : undefined)
        .orderBy(desc(assets.createdAt))
        .limit(500);
    },

    async remove(id) {
      await db.delete(assets).where(eq(assets.id, id));
    },
  };
}
