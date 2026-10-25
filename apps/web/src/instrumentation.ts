/**
 * Next.js 启动钩子。拆分创作域之后，这里只剩**产品域**的启动责任：
 *
 * - 任务孤儿恢复与积分冻结对账已搬到 `apps/creation`（创作域职责，且那里是单实例）；
 *   两边都跑会在 web 多实例时误杀别人正在跑的任务。
 *
 * 此处触发消息中心的保留期清理（已读且超过 90 天的投递行，D12）：挂在启动钩子而非
 * 定时器，是为了让清理随部署自然发生，不必额外常驻进程；清理本身幂等且失败不阻塞启动。
 */
export async function register(): Promise<void> {
  // 仅 Node 运行时执行；Edge 无 DB 访问（与 proxy.ts 边界一致）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { notificationsService } = await import("@oops/domain/notifications/service");
    const purged = await notificationsService.cleanupExpired();
    if (purged > 0) {
      console.log(`[startup] 清理过期已读通知投递行 ${purged} 条`);
    }
  } catch (err) {
    console.error("[startup] 清理过期通知失败（不影响启动）:", err);
  }
}
