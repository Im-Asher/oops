/**
 * GET  /api/admin/invite-codes：邀请码管理列表（分页 + 用量/状态派生）。
 * POST /api/admin/invite-codes：批量生成（1–100 个），生成与审计同事务（invite.create，
 * after 含生成码清单便于追溯发放）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import {
  createInviteCodeRepo,
  type AdminInviteCodePage,
  type InviteCode,
} from "@oops/db/invite-code.repo";
import { withAudit } from "@oops/db/admin-audit.repo";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  count: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).max(99).default(1),
  /** ISO 8601 含时区；null/缺省 = 永久有效 */
  expiresAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().max(200).nullish(),
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
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "分页参数不合法" } },
      { status: 422 },
    );
  }
  const page: AdminInviteCodePage = await createInviteCodeRepo().listForAdmin(
    parsed.data,
  );
  return Response.json(page);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "生成参数不合法" } },
      { status: 422 },
    );
  }
  const input = {
    count: parsed.data.count,
    maxUses: parsed.data.maxUses,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    note: parsed.data.note ?? null,
  };
  // 生成与审计同事务；审计 after 复用生成结果（码清单 + 生成口径）
  const rows = await withAudit<InviteCode[]>(
    (fn) => db.transaction(fn),
    (created) => ({
      adminUserId: guard.userId,
      action: "invite.create" as const,
      targetType: "invite_code" as const,
      after: {
        count: created.length,
        maxUses: input.maxUses,
        expiresAt: input.expiresAt?.toISOString() ?? null,
        note: input.note,
        codes: created.map((r) => r.code),
      },
    }),
    (tx) => createInviteCodeRepo(tx).generateBatch(input),
  );
  return Response.json({ codes: rows.map((r) => r.code) });
}
