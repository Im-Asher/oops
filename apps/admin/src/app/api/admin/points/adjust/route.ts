/**
 * POST /api/admin/points/adjust：后台积分调整（M2 task 5.2）。
 * 事务/审计/防超扣语义在 domain creditsService.adjustCredits 内；
 * 路由层只做守卫 + 入参校验 + 结构化错误映射（402 语义之外的超额扣减映射 422）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@oops/auth";
import { creditsService } from "@oops/domain/credits/service";
import { TaskError } from "@oops/domain/tasks/task-error";
import { InsufficientCreditsError } from "@oops/db/credit-ledger.repo";

const adjustSchema = z.object({
  userId: z.string().min(1),
  /** 带符号整数（分）：正=发放，负=扣减；0 无意义拒绝 */
  delta: z.number().int().refine((n) => n !== 0, "delta 不能为 0"),
  note: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = adjustSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "调整参数不合法" } },
      { status: 422 },
    );
  }
  try {
    const { balance } = await creditsService.adjustCredits({
      ...parsed.data,
      adminId: guard.userId,
    });
    return Response.json({ balance });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return Response.json(
        { error: { code: "INSUFFICIENT_CREDITS", message: "余额不足，无法扣减" } },
        { status: 422 },
      );
    }
    if (e instanceof TaskError) {
      return Response.json(
        { error: { code: e.kind, message: e.message } },
        { status: 422 },
      );
    }
    throw e;
  }
}
