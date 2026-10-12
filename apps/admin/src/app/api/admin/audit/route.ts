import { requireAdmin } from "@oops/auth";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  createAdminAuditRepo,
} from "@oops/db/admin-audit.repo";
import { z } from "zod";

export const dynamic = "force-dynamic";

// 全部过滤参数可选；from/to 为 ISO 日期串（coerce 为 Date），page 1-based
const querySchema = z.object({
  adminUserId: z.string().min(1).optional(),
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  targetType: z.enum(ADMIN_AUDIT_TARGET_TYPES).optional(),
  targetId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/admin/audit：审计流水过滤分页查询（createdAt 倒序）。
 * 管理端 API 三分支与页面同构：未认证 401 / 非 admin 403 / 放行查询。
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
      { error: { code: "INVALID_QUERY", message: "过滤参数不合法" } },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const result = await createAdminAuditRepo().list({
    adminUserId: q.adminUserId,
    action: q.action,
    targetType: q.targetType,
    targetId: q.targetId,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
  });
  return Response.json(result);
}
