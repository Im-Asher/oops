/**
 * GET /api/admin/points/reconcile：恒等式对账扫描（M2 task 5.2）。
 * 口径：users.creditBalance == Σ(该用户全部 credit_ledger.amount)；
 * mismatches 为空数组即「全部一致」。只读。
 */
import { requireAdmin } from "@oops/auth";
import { createCreditLedgerRepo } from "@oops/db/credit-ledger.repo";

export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const mismatches = await createCreditLedgerRepo().reconcileBalances();
  return Response.json({
    consistent: mismatches.length === 0,
    total: mismatches.length,
    mismatches,
  });
}
