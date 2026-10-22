import { z } from "zod";
import { db } from "@oops/db";
import { createAssetRepo } from "@oops/db/asset.repo";
import {
  createTagRepo,
  EmptyTagNameError,
  MAX_TAGS_PER_ASSET,
  MAX_TAG_NAME_LENGTH,
  TagNameTooLongError,
  TooManyTagsError,
} from "@oops/db/tag.repo";
import { requireUser } from "@oops/auth/require-user";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

export const dynamic = "force-dynamic";

/**
 * PATCH：收藏 / 取消收藏、改标题、覆盖式设置标签。
 * 标签的 clear+link 必须同事务——否则 link 失败会静默清空用户已有标签（见 design.md D3）。
 */
const patchSchema = z
  .object({
    /** 收藏时间；null 表示取消收藏。省略表示不改动该字段。 */
    savedAt: z.string().datetime().nullable().optional(),
    title: z.string().trim().max(120).nullable().optional(),
    /** 覆盖式：传什么就是什么；省略表示不改动标签。 */
    tags: z.array(z.string().min(1).max(MAX_TAG_NAME_LENGTH)).max(MAX_TAGS_PER_ASSET).optional(),
  })
  .refine((v) => v.savedAt !== undefined || v.title !== undefined || v.tags !== undefined, {
    message: "至少需要一个变更字段",
  });

/**
 * GET：单图详情。画布/作品集把assetId 转交排版设计时用它换地址——
 * 传id 而非 url，服务端校验归属后才给地址，避免手改参数注入外链（design.md D7）。
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const { id } = await params;
  const asset = await createAssetRepo().getSaved(id, userId);
  if (!asset) {
    return Response.json({ error: { code: "NOT_FOUND", message: "图片不存在" } }, { status: 404 });
  }
  const tags = await createTagRepo().listByAssetIds([id]);
  return Response.json({
    item: {
      id: asset.id,
      url: `/files/${asset.storageKey}`,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      kind: asset.kind,
      title: asset.title,
      savedAt: asset.savedAt,
      sessionId: asset.sessionId,
      tags: tags.map((t) => ({ tagId: t.tagId, name: t.name })),
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "请求体需为 JSON" } }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID", message: parsed.error.message } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const assets = createAssetRepo();

  // 先确认归属：他人资产一律 404（不泄露存在性）
  const owned = await assets.getSaved(id, userId);
  if (!owned) {
    return Response.json({ error: { code: "NOT_FOUND", message: "图片不存在" } }, { status: 404 });
  }

  const { savedAt, title, tags } = parsed.data;

  try {
    // savedAt 已是 ISO 字符串（zod .datetime() 校验过），直接解析为 timestamp
    await db.transaction(async (tx) => {
      await createAssetRepo(tx).setSaved(id, userId, {
        ...(savedAt !== undefined && { savedAt: savedAt === null ? null : new Date(savedAt) }),
        ...(title !== undefined && { title }),
      });

      if (tags !== undefined) {
        const repo = createTagRepo(tx);
        // findOrCreate 逐个取/建标签，再覆盖式写入关联（同事务，失败不留半成品）
        const tagIds: string[] = [];
        for (const name of tags) {
          tagIds.push((await repo.findOrCreate(name)).id);
        }
        await repo.clearForAsset(id);
        // 空集合的语义已由 clear 完成，不必再调 linkTags
        if (tagIds.length > 0) await repo.linkTags(id, tagIds);
      }
    });
  } catch (err) {
    if (
      err instanceof EmptyTagNameError ||
      err instanceof TagNameTooLongError ||
      err instanceof TooManyTagsError
    ) {
      return Response.json(
        { error: { code: "INVALID", message: err.message } },
        { status: 400 },
      );
    }
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "保存失败，请稍后重试" } },
      { status: 500 },
    );
  }

  const updated = await assets.getSaved(id, userId);
  return Response.json({
    item: updated
      ? { id: updated.id, title: updated.title, savedAt: updated.savedAt }
      : null,
  });
}

/**
 * DELETE：彻底删除作品（含对象字节）。
 * 字节先删、成功后才删行——行先删则字节删除失败时无法重试，会留下永久孤儿对象。
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const { id } = await params;
  const key = await createAssetRepo().getOwnedKey(id, userId);
  if (!key) {
    return Response.json({ error: { code: "NOT_FOUND", message: "图片不存在" } }, { status: 404 });
  }
  try {
    await createStorage(defaultS3Client).removeObject(key);
  } catch {
    return Response.json(
      { error: { code: "ASSET_DELETE_FAILED", message: "图片删除失败，请稍后重试" } },
      { status: 500 },
    );
  }
  await createAssetRepo().remove(id);
  return Response.json({ ok: true });
}