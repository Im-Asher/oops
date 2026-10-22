import { z } from "zod";
import { requireUser } from "@oops/auth/require-user";
import { notificationsService } from "@oops/domain/notifications/service";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  source: z.enum(["system", "admin"]).optional(),
});

/** 列出当前用户的消息（仅本人投递且未撤回，createdAt 倒序）。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const url = new URL(req.url);
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: parsed.error.message } }, { status: 400 });
  }
  const page = await notificationsService.listForUser({ userId, ...parsed.data });
  return Response.json({
    items: page.items.map((n) => ({
      id: n.id,
      source: n.source,
      category: n.category,
      level: n.level,
      title: n.title,
      body: n.body,
      i18nKey: n.i18nKey,
      i18nParams: n.i18nParams,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    })),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  });
}