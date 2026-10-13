/**
 * GET /api/admin/points/ledger：积分流水查询（M2 task 5.2）。
 * 过滤：userId / type / from / to（ISO 含时区）；createdAt 倒序分页。读操作直调仓储。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@oops/auth";
import { createCreditLedgerRepo } from "@oops/db/credit-ledger.repo";

const listQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  type: z.enum(["freeze", "settle", "release", "grant", "adjust"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    userId: url.searchParams.get("userId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "查询参数不合法" } },
      { status: 422 },
    );
  }
  const { from, to, ...rest } = parsed.data;
  const page = await createCreditLedgerRepo().listLedger({
    ...rest,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  });
  return Response.json(page);
}
