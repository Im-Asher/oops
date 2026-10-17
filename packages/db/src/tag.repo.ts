import { eq, inArray } from "drizzle-orm";
import { db as defaultDb } from ".";
import type { DbClient } from "./credit-ledger.repo";
import { assetTags, tags, type Tag } from "./schema";

/** 标签名归一：仅去除首尾空白。刻意不做大小写折叠——见 design.md D3。 */
export function normalizeTagName(name: string): string {
  return name.trim();
}

/** 标签名长度上限。schema 层用 check 兜底，此处先行拦截以给出可分类的错误。 */
export const MAX_TAG_NAME_LENGTH = 64;

/** 单个资产可关联的标签数上限：防 inArray/批量 insert 触到 PG 参数上限，也给 UI 一个明确边界。 */
export const MAX_TAGS_PER_ASSET = 50;

export class EmptyTagNameError extends Error {
  constructor() {
    super("标签名不能为空");
    this.name = "EmptyTagNameError";
  }
}

export class TagNameTooLongError extends Error {
  constructor(readonly limit: number) {
    super(`标签名超过 ${limit} 字上限`);
    this.name = "TagNameTooLongError";
  }
}

export class TooManyTagsError extends Error {
  constructor(readonly limit: number) {
    super(`标签数超过 ${limit} 个上限`);
    this.name = "TooManyTagsError";
  }
}

/**
 * 数据层不变式被破坏：冲突插入后回查不到该name 的行。
 * 正常路径下不可能发生（行由并发方提交，READ COMMITTED 下新快照可见），
 * 除非标签在这两条语句之间被删除——但系统刻意不提供标签删除入口。
 * message 刻意不含用户原始输入，避免日志注入与无界拼接。
 */
export class TagLookupInvariantError extends Error {
  constructor() {
    super("标签冲突插入后回查失败：标签池状态异常");
    this.name = "TagLookupInvariantError";
  }
}

export interface AssetTagLink {
  assetId: string;
  tagId: string;
  name: string;
}

export interface TagRepo {
  /**
   * 按名取或建。实现为 insert ... onConflictDoNothing + 回查，
   * 避免"先select 再 insert"的并发竞态（两个请求同时建同名标签）。
   *
   * 并发正确性依赖两个前提，不得把本方法放进 REPEATABLE READ / SERIALIZABLE
   * 事务——那种隔离级别下新快照看不到胜出行，会伪报 TagLookupInvariantError。
   * @throws EmptyTagNameError / TagNameTooLongError归一后为空或过长。
   */
  findOrCreate(name: string): Promise<Tag>;
  /**
   * 批量取资产标签，供列表页避免 N+1。空 ids 不触库。
   * 归属校验由调用方完成（沿用 asset.repo.getManyByIds 的既有约定）。
   */
  listByAssetIds(assetIds: string[]): Promise<AssetTagLink[]>;
  /** 清空某资产的全部标签关联。 */
  clearForAsset(assetId: string): Promise<void>;
  /** 写入某资产的标签关联。 */
  linkTags(assetId: string, tagIds: string[]): Promise<void>;
}

export function createTagRepo(db: DbClient = defaultDb): TagRepo {
  return {
    async findOrCreate(name) {
      const normalized = normalizeTagName(name);
      if (normalized.length === 0) throw new EmptyTagNameError();
      if (normalized.length > MAX_TAG_NAME_LENGTH) throw new TagNameTooLongError(MAX_TAG_NAME_LENGTH);

      const inserted = await db
        .insert(tags)
        .values({ name: normalized })
        .onConflictDoNothing({ target: tags.name })
        .returning();
      if (inserted[0]) return inserted[0];

      // 冲突分支：name 已存在，回查取既有行
      const rows = await db.select().from(tags).where(eq(tags.name, normalized)).limit(1);
      const existing = rows[0];
      if (!existing) throw new TagLookupInvariantError();
      return existing;
    },

    async listByAssetIds(assetIds) {
      if (assetIds.length === 0) return [];
      const rows = await db
        .select({ assetId: assetTags.assetId, tagId: tags.id, name: tags.name })
        .from(assetTags)
        .innerJoin(tags, eq(assetTags.tagId, tags.id))
        .where(inArray(assetTags.assetId, assetIds));
      return rows.map((r) => ({ assetId: r.assetId, tagId: r.tagId, name: r.name }));
    },

    async clearForAsset(assetId) {
      await db.delete(assetTags).where(eq(assetTags.assetId, assetId));
    },

    async linkTags(assetId, tagIds) {
      const deduped = [...new Set(tagIds)];
      if (deduped.length === 0) return;
      if (deduped.length > MAX_TAGS_PER_ASSET) {
        throw new TooManyTagsError(MAX_TAGS_PER_ASSET);
      }
      await db
        .insert(assetTags)
        .values(deduped.map((tagId) => ({ assetId, tagId })))
        .onConflictDoNothing();
    },
  };
}