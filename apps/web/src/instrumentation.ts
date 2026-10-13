/**
 * Next.js 启动钩子：单实例下进程重启后，上一进程残留的 pending/running
 * 任务是孤儿（标记 failed），其冻结由对账扫描释放。web 专有逻辑，web/app
 * 之外的入口（脚本）不经过此处。
 */
export async function register(): Promise<void> {
  // 仅 Node 运行时执行；Edge 无 DB 访问（与 proxy.ts 边界一致）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverInterruptedTasks } = await import("@oops/domain/tasks/executor");
  const { creditsService } = await import("@oops/domain/credits/service");
  const recovered = await recoverInterruptedTasks();
  const reconciled = await creditsService.reconcileFrozen();
  if (recovered > 0 || reconciled > 0) {
    console.log(`[startup] 恢复中断任务 ${recovered} 个，释放泄漏冻结 ${reconciled} 笔`);
  }
}
