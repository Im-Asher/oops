/**
 * GET /api/admin/points/prices：全部价目清单（按 key 排序）。读操作直调仓储。
 * PUT /api/admin/points/prices：修改任务单价（M2 task 5.2）——domain service
 * 同事务 upsert + 审计（pricing.update，before=改前单价）；改价后新任务按新价冻结
 * （freezeForTask 每次实时 getPrice）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@oops/auth";
import { creditsService } from "@oops/domain/credits/service";
import { TaskError } from "@oops/domain/tasks/task-error";
import { createCreditLedgerRepo } from "@oops/db/credit-ledger.repo";

const priceSchema = z.object({
  key: z.string().min(1).max(64),
  /** 单价（非负整数分） */
  credits: z.number().int().min(0),
  note: z.string().max(200).optional(),
});

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const prices = await createCreditLedgerRepo().listPrices();
  return Response.json({ items: prices });
}

export async function PUT(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = priceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "价目参数不合法" } },
      { status: 422 },
    );
  }
  try {
    await creditsService.setTaskPrice({
      ...parsed.data,
      adminId: guard.userId,
    });
    const price = await createCreditLedgerRepo().getPrice(parsed.data.key);
    return Response.json({ price: { key: parsed.data.key, credits: price } });
  } catch (e) {
    if (e instanceof TaskError) {
      return Response.json(
        { error: { code: e.kind, message: e.message } },
        { status: 422 },
      );
    }
    throw e;
  }
}
