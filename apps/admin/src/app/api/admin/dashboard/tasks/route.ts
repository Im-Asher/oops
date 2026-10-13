import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { getTaskDashboardStats } from "@oops/db/task.repo";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/dashboard/tasks：任务事实看板（M2 task 7.1）。
 * 全量状态分布 + 24h 窗口失败率/均耗时 + 最近失败明细（只读聚合）。
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const stats = await getTaskDashboardStats(db, 24);
  return Response.json({
    statusCounts: stats.statusCounts,
    window: {
      startedAt: stats.window.startedAt.toISOString(),
      terminalCount: stats.window.terminalCount,
      failedCount: stats.window.failedCount,
      failureRate: stats.window.failureRate,
      avgDurationMs: stats.window.avgDurationMs,
    },
    recentFailures: stats.recentFailures.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      error: t.error,
      sessionId: t.sessionId,
      userId: t.userId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}
