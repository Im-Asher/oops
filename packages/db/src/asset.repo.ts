import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db as defaultDb } from ".";
import { assetTags, assets, sessions, type Asset } from "./schema";

export interface AssetInput {
  storageKey: string;
  mimeType: string;
  sessionId?: string;
  kind?: "image" | "json" | "other" | "edited";
  width?: number;
  height?: number;
  prompt?: string;
  model?: string;
  sourceUrl?: string;
  meta?: unknown;
  userId: string;
}

/** 作品集列表的复合游标：savedAt + id。 */
export interface SavedCursor {
  savedAt: Date;
  id: string;
}

export interface ListSavedOptions {
  cursor?: SavedCursor;
  /** 标签筛选（关联表命中即可）。 */
  tagId?: string;
  /** 来源筛选：画布生成的资产 kind。不传=不过滤。 */
  kind?: "image" | "json" | "other" | "edited";
  limit?: number;
}

export const MAX_SAVED_PAGE_SIZE = 50;
export const DEFAULT_SAVED_PAGE_SIZE = 24;

/** 作品集条目：资产本体 + 来源会话标题（会话可能已被删除，故为 null）。 */
export interface SavedAssetItem extends Asset {
  sessionTitle: string | null;
}

export interface AssetRepo {
  create(input: AssetInput): Promise<Asset>;
  get(id: string): Promise<Asset | undefined>;
  /** 按 id 批量取资产（引用注入用；归属校验由调用方完成）。 */
  getManyByIds(ids: string[]): Promise<Asset[]>;
  list(sessionId?: string): Promise<Asset[]>;
  /** 会话删除时的资产 GC：无上限列出该会话全部对象的 storageKey。 */
  listKeysBySession(sessionId: string): Promise<string[]>;
  /** 按会话删除资产行（对象字节由调用方经 storage 清理后调用）。 */
  removeBySession(sessionId: string): Promise<void>;
  remove(id: string): Promise<void>;

  // —— 作品集——

  /**
   * 作品集列表：按收藏时间倒序，跨会话聚合。
   * 归属校验内聚在本方法（强制带 userId）。
   */
  listSaved(userId: string, options?: ListSavedOptions): Promise<SavedAssetItem[]>;
  /** 收藏态判断；非本人资产一律undefined（不泄露存在性）。 */
  getSaved(id: string, userId: string): Promise<Asset | undefined>;
  /** 收藏/取消收藏 + 可选改标题。幂等。 */
  setSaved(
    id: string,
    userId: string,
    update: { savedAt: Date | null; title?: string | null },
  ): Promise<Asset | undefined>;
  /** 取本人资产的 storageKey 供调用方删字节；非本人返回 undefined。 */
  getOwnedKey(id: string, userId: string): Promise<string | undefined>;

  /**
   * 会话删除时的资产 GC（已收藏豁免）：只列出 savedAt 为空的 storageKey。
   * 与 listKeysBySession 并存而非替换——后者语义是无条件按会话删。
   */
  listKeysBySessionUnsaved(sessionId: string): Promise<string[]>;
  /** 按会话删除未收藏资产行；已收藏行保留。 */
  removeUnsavedBySession(sessionId: string): Promise<void>;
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
          userId: input.userId,
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

    async getManyByIds(ids) {
      if (ids.length === 0) return [];
      return db.select().from(assets).where(inArray(assets.id, ids));
    },

    async list(sessionId) {
      return db
        .select()
        .from(assets)
        .where(sessionId ? eq(assets.sessionId, sessionId) : undefined)
        .orderBy(desc(assets.createdAt))
        .limit(500);
    },

    async listKeysBySession(sessionId) {
      const rows = await db
        .select({ storageKey: assets.storageKey })
        .from(assets)
        .where(eq(assets.sessionId, sessionId));
      return rows.map((row) => row.storageKey);
    },

    async removeBySession(sessionId) {
      await db.delete(assets).where(eq(assets.sessionId, sessionId));
    },

    async remove(id) {
      await db.delete(assets).where(eq(assets.id, id));
    },

    async listSaved(userId, options = {}) {
      const limit = Math.min(options.limit ?? DEFAULT_SAVED_PAGE_SIZE, MAX_SAVED_PAGE_SIZE);
      const conditions = [eq(assets.userId, userId), isNotNull(assets.savedAt)];

      // 复合游标：按(saved_at DESC, id DESC) 定位。严格不等式排除同值行，
      // 保证翻页无重复无遗漏（同毫秒并列也不会被跳过）。
      if (options.cursor) {
        const { savedAt, id } = options.cursor;
        conditions.push(
          or(
            lt(assets.savedAt, savedAt),
            and(eq(assets.savedAt, savedAt), lt(assets.id, id)),
          )!,
        );
      }
      if (options.kind) conditions.push(eq(assets.kind, options.kind));
      if (options.tagId) {
        // 用EXISTS 子查询而非 join：避免一资产多标签导致的行放大与分页错乱
        conditions.push(
          sql`exists (select 1 from ${assetTags} where ${assetTags.assetId} = ${assets.id} and ${assetTags.tagId} = ${options.tagId})`,
        );
      }

      const rows = await db
        .select({ asset: assets, sessionTitle: sessions.title })
        .from(assets)
        .leftJoin(sessions, eq(assets.sessionId, sessions.id))
        .where(and(...conditions))
        .orderBy(desc(assets.savedAt), desc(assets.id))
        .limit(limit);
      return rows.map((r) => ({ ...r.asset, sessionTitle: r.sessionTitle ?? null }));
    },

    async getSaved(id, userId) {
      const rows = await db
        .select()
        .from(assets)
        .where(and(eq(assets.id, id), eq(assets.userId, userId)))
        .limit(1);
      return rows[0];
    },

    async setSaved(id, userId, update) {
      const patch: Partial<typeof assets.$inferInsert> = { savedAt: update.savedAt };
      if (update.title !== undefined) patch.title = update.title;
      const rows = await db
        .update(assets)
        .set(patch)
        .where(and(eq(assets.id, id), eq(assets.userId, userId)))
        .returning();
      return rows[0];
    },

    async getOwnedKey(id, userId) {
      const rows = await db
        .select({ storageKey: assets.storageKey })
        .from(assets)
        .where(and(eq(assets.id, id), eq(assets.userId, userId)))
        .limit(1);
      return rows[0]?.storageKey;
    },

    async listKeysBySessionUnsaved(sessionId) {
      const rows = await db
        .select({ storageKey: assets.storageKey })
        .from(assets)
        .where(and(eq(assets.sessionId, sessionId), isNull(assets.savedAt)));
      return rows.map((row) => row.storageKey);
    },

    async removeUnsavedBySession(sessionId) {
      await db
        .delete(assets)
        .where(and(eq(assets.sessionId, sessionId), isNull(assets.savedAt)));
    },
  };
}
