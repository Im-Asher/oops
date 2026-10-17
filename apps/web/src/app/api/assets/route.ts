import { z } from "zod";
import {
  createAssetRepo,
  DEFAULT_SAVED_PAGE_SIZE,
  MAX_SAVED_PAGE_SIZE,
} from "@oops/db/asset.repo";
import { createTagRepo } from "@oops/db/tag.repo";
import { requireUser } from "@oops/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * 作品集列表游标编码：base64("<isoTime>|<uuid>")。
 * 复合游标（含 id）保证同毫秒并列的行也不会在翻页时被跳过或重复。
 */
function encodeCursor(savedAt: Date, id: string): string {
  return Buffer.from(`${savedAt.toISOString()}|${id}`, "utf8").toString("base64");
}

function decodeCursor(raw: string): { savedAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep <= 0) return null;
    const savedAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(savedAt.getTime()) || !id) return null;
    return { savedAt, id };
  } catch {
    return null;
  }
}

const listQuery = z.object({
  /** 仅取已收藏的作品集条目。 */
  saved: z.coerce.boolean().optional(),
  /** 逗号分隔的 assetId：批量收藏态查询（画布星标用），与 cursor 互斥。 */
  ids: z.string().optional(),
  tag: z.string().min(1).max(64).optional(),
  kind: z.enum(["image", "json", "other", "edited"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SAVED_PAGE_SIZE).optional(),
});

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID", message: parsed.error.message } },
      { status: 400 },
    );
  }
  const { saved, ids, tag, kind, cursor, limit } = parsed.data;

  // —— 批量收藏态：ids 优先，忽略分页与标签参数 ——
  if (ids) {
    const assetIds = ids
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .slice(0, 200);
    if (assetIds.length === 0) {
      return Response.json({ items: [] });
    }
    const rows = await createAssetRepo().getManyByIds(assetIds);
    const owned = new Set(rows.filter((r) => r.userId === userId).map((r) => r.id));
    // 未命中的按未收藏返回，客户端无需为每张图单独判空
    return Response.json({
      items: assetIds.map((id) => ({ id, saved: owned.has(id) })),
    });
  }

  if (saved !== true) {
    return Response.json({ items: [] });
  }

  //标签筛选：按名find-or-create 拿到 tagId（不存在则该筛选无结果）
  let tagId: string | undefined;
  if (tag) {
    try {
      tagId = (await createTagRepo().findOrCreate(tag)).id;
    } catch {
      return Response.json(
        { error: { code: "INVALID", message: "标签名无效" } },
        { status: 400 },
      );
    }
  }

  const decodedCursor = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    return Response.json(
      { error: { code: "INVALID", message: "游标无效" } },
      { status: 400 },
    );
  }

  const pageSize = limit ?? DEFAULT_SAVED_PAGE_SIZE;
  const items = await createAssetRepo().listSaved(userId, {
    cursor: decodedCursor ?? undefined,
    tagId,
    kind,
    limit: pageSize,
  });
  const tags = await createTagRepo().listByAssetIds(items.map((i) => i.id));
  const tagsByAsset = new Map<string, { tagId: string; name: string }[]>();
  for (const link of tags) {
    const list = tagsByAsset.get(link.assetId);
    if (list) list.push({ tagId: link.tagId, name: link.name });
    else tagsByAsset.set(link.assetId, [{ tagId: link.tagId, name: link.name }]);
  }

  const last = items.at(-1);
  return Response.json({
    items: items.map((i) => ({
      id: i.id,
      url: `/files/${i.storageKey}`,
      mimeType: i.mimeType,
      width: i.width,
      height: i.height,
      prompt: i.prompt,
      model: i.model,
      kind: i.kind,
      title: i.title,
      savedAt: i.savedAt,
      sessionId: i.sessionId,
      sessionTitle: i.sessionTitle,
      tags: tagsByAsset.get(i.id) ?? [],
    })),
    // 取满页才可能有下一页；不足一页即末页，nextCursor 为 null 时客户端停止加载
    nextCursor:
      items.length === pageSize && last?.savedAt ? encodeCursor(last.savedAt, last.id) : null,
  });
}