import type { IncomingMessage, ServerResponse } from "node:http";
import { encodeSseFrame, SSE_HEARTBEAT_FRAME } from "@oops/contracts/events";
import { runRequestSchema } from "@oops/contracts/run";
import type { Asset } from "@oops/db/schema";
import { buildReferenceBlock } from "@oops/domain/messages/reference";
import { agentRegistry } from "../agent/registry";
import { runAgent } from "../agent/runtime";
import { loadReferenceAssets, loadVisionImages } from "../store/vision";
import { readJsonBody, sendError } from "./respond";

/** 心跳间隔：本地反代/浏览器对长连接的空闲容忍度参差，15s 一条注释行足够。 */
const HEARTBEAT_MS = 15_000;
/** runId 幂等窗口：窗口内重复提交直接 409（不重复扣费），过期后允许复用。 */
const RUN_ID_TTL_MS = 10 * 60_000;

const activeRuns = new Map<string, number>();

function purgeExpiredRuns(now: number): void {
  for (const [id, startedAt] of activeRuns) {
    if (now - startedAt > RUN_ID_TTL_MS) activeRuns.delete(id);
  }
}

/** 占位成功返回 true；窗口内已存在返回 false。 */
function claimRun(runId: string): boolean {
  const now = Date.now();
  purgeExpiredRuns(now);
  if (activeRuns.has(runId)) return false;
  activeRuns.set(runId, now);
  return true;
}

/**
 * `POST /v1/runs`：一次 Agent 回合，SSE 流式返回。
 *
 * 错误分层与设计一致：建连前（鉴权/参数/未知 Agent/重复 runId）用 HTTP 状态码 + JSON；
 * 建连后（模型/工具/中断）一律走 SSE `error` 事件，由前端展示。
 */
export async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  if (body === null) {
    sendError(res, 400, "BAD_JSON", "请求体需为 JSON 且不超过 1MB");
    return;
  }
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, "INVALID", parsed.error.message);
    return;
  }
  const payload = parsed.data;

  const def = agentRegistry.get(payload.agentId);
  if (!def) {
    sendError(res, 404, "UNKNOWN_AGENT", `未知 Agent：${payload.agentId}`);
    return;
  }
  if (!claimRun(payload.runId)) {
    sendError(res, 409, "DUPLICATE_RUN", "同一 runId 已在执行，请勿重复提交");
    return;
  }

  // 引用注入：本轮模型可见文本 = 原文 + 引用块（与 web 写 user 行用同一份实现）。
  let referenceAssets: Asset[];
  try {
    referenceAssets = await loadReferenceAssets(payload.referenceAssetIds);
  } catch (err) {
    console.error("[creation] 引用资产读取失败:", err);
    sendError(res, 500, "ASSET_READ_FAILED", "引用图片读取失败");
    return;
  }
  const userText =
    payload.message +
    (referenceAssets.length > 0 ? `\n\n${buildReferenceBlock(referenceAssets)}` : "");

  // vision 注入：只有声明了 vision 能力的 Agent 才把图片字节并入本轮输入。
  const needsVision = def.models?.main?.capabilities?.includes("vision") ?? false;
  let images: Awaited<ReturnType<typeof loadVisionImages>> = [];
  if (needsVision) {
    try {
      images = await loadVisionImages(referenceAssets);
    } catch (err) {
      console.error("[creation] 引用图片字节读取失败:", err);
      sendError(res, 500, "ASSET_READ_FAILED", "引用图片读取失败");
      return;
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // 明确告知 nginx 类反代不要缓冲，否则流会被攒成一整块
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const ac = new AbortController();
  // 客户端断开（用户点停止 / 关页面）→ 中断 loop；runAgent 内部会自然部分落库。
  res.on("close", () => ac.abort());
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(SSE_HEARTBEAT_FRAME);
  }, HEARTBEAT_MS);

  try {
    await runAgent({
      sessionId: payload.sessionId,
      userId: payload.userId,
      agentId: payload.agentId,
      userText,
      userMessageId: payload.userMessageId,
      images,
      signal: ac.signal,
      onEvent: (event) => {
        if (!res.writableEnded) res.write(encodeSseFrame(event));
      },
    });
  } catch (err) {
    if (!ac.signal.aborted) {
      const message = (err as Error)?.message ?? "生成失败";
      if (!res.writableEnded) res.write(encodeSseFrame({ type: "error", message }));
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}
