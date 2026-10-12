import { requireAdmin } from "@oops/auth";
import { createUserRepo } from "@oops/db/user.repo";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/admin/users：用户搜索分页列表（用户名 / oops ID / 昵称模糊，注册时间倒序）。
 * 全部管理端 API 三分支同构：未认证 401 / 非 admin 403 / 放行业务。
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_QUERY", message: "查询参数不合法" } },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const { items, ...rest } = await createUserRepo().listForAdmin({
    search: q.search,
    page: q.page,
    pageSize: q.pageSize,
  });
  // 剥离口令哈希：管理列表展示面不含敏感字段
  return Response.json({
    ...rest,
    items: items.map(({ passwordHash: _hash, ...safe }) => safe),
  });
}
