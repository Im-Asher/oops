import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getCreationConfig } from "@oops/config";
import "../agent"; // 副作用：注册 Agent / 工具 / 任务处理器
import { agentRegistry } from "../agent/registry";
import { posterSatoriFonts } from "../render/fonts";
import { sendError, sendJson } from "./respond";
import { handleRun } from "./run";

/**
 * 启动对账：上一进程残留的 pending/running 任务是孤儿（标记 failed），
 * 其冻结由对账扫描释放。单实例下安全；web 不再承担这件事。
 * 失败只记日志不阻止监听——DB 未就绪时首个请求会自然报错。
 */
async function reconcileOnStartup(): Promise<void> {
  try {
    const { recoverInterruptedTasks } = await import("@oops/domain/tasks/executor");
    const { creditsService } = await import("@oops/domain/credits/service");
    const recovered = await recoverInterruptedTasks();
    const reconciled = await creditsService.reconcileFrozen();
    if (recovered > 0 || reconciled > 0) {
      console.log(`[creation] 恢复中断任务 ${recovered} 个，释放泄漏冻结 ${reconciled} 笔`);
    }
  } catch (err) {
    console.error("[creation] 启动对账失败（不阻止监听）:", err);
  }
}

function isInternalRequest(req: IncomingMessage, token: string): boolean {
  return req.headers["x-internal-token"] === token;
}

/** 渲染器可用性：字体读不出来时海报渲染必然失败，提前在 /health 暴露。 */
function fontsAvailable(): boolean {
  try {
    posterSatoriFonts();
    return true;
  } catch {
    return false;
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://creation.local");
  const { internalToken } = getCreationConfig();

  // 存活探针不要求内部令牌（doctor / 容器探针用）。
  if (req.method === "GET" && url.pathname === "/health") {
    const fonts = fontsAvailable();
    sendJson(res, fonts ? 200 : 503, {
      ok: fonts,
      agents: agentRegistry.list().length,
      renderer: { engine: "satori", fonts },
    });
    return;
  }

  if (!isInternalRequest(req, internalToken)) {
    sendError(res, 401, "UNAUTHENTICATED", "缺少或无效的 x-internal-token");
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/agents") {
    sendJson(res, 200, { agents: agentRegistry.metadata() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/runs") {
    await handleRun(req, res);
    return;
  }

  sendError(res, 404, "NOT_FOUND", `未知路径：${req.method} ${url.pathname}`);
}

export async function startCreationServer(): Promise<void> {
  const { port } = getCreationConfig();
  await reconcileOnStartup();

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error("[creation] 未捕获的请求异常:", err);
      if (!res.headersSent) sendError(res, 500, "INTERNAL", "内部错误");
      else if (!res.writableEnded) res.end();
    });
  });

  server.listen(port, () => {
    console.log(
      `[creation] 创作域已启动：http://localhost:${port}（${agentRegistry.list().length} 个 Agent）`,
    );
  });

  // Ctrl+C / 容器停止：等在跑的请求收尾（cap 10s），避免留下孤儿任务
  const shutdown = (signal: string) => {
    console.log(`[creation] 收到 ${signal}，停止监听…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
