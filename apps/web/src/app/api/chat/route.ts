import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UserMessage } from "@earendil-works/pi-ai";
import { requireUser } from "@oops/auth/require-user";
import { getCreationConfig } from "@oops/config";
import { createAssetRepo } from "@oops/db/asset.repo";
import { createMessageRepo, type MessageRepo } from "@oops/db/message.repo";
import { createSessionRepo } from "@oops/db/session.repo";
import type { Asset } from "@oops/db/schema";
import { creditsService } from "@oops/domain/credits/service";
import { buildReferenceBlock } from "@oops/domain/messages/reference";
import { notificationsService } from "@oops/domain/notifications/service";
import { sanitizeTranscript } from "@oops/llm/transcript";
import { isVisionAgent } from "@/server/creation/client";
import { screenInput } from "@/server/moderation";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1),
  // 画布选中图片引用（≤5）：服务端归属校验后注入为引用块。
  referenceAssetIds: z.array(z.string().min(1)).max(5).optional(),
});

/**
 * 聊天入口（BFF）：认证 → 余额预检 → 校验 → 落库 user 行 → 转 creation。
 *
 * 这里**不解析、不重组、不缓存** creation 的 SSE 流：拿到 body 直接 pipe 给浏览器，
 * 前端消费的事件格式与拆分前逐字节一致。创作域的执行、任务、积分冻结/结算、
 * assistant 行落库全部在 creation 进程内完成。
 */
export async function POST(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  // 生成闸门（credits spec）：余额 ≤ 0 在入口整面板拒绝（402），避免落库消息后才失败。
  // 正确性边界仍由 creation 侧冻结时的条件 UPDATE 硬校验兜底，此处仅是体验层预检。
  const gate = await creditsService.checkGate(userId);
  if (!gate.ok) {
    // 通知失败 MUST NOT 改变拒绝结果（credits spec「生成闸门」），故此处兜住异常。
    try {
      await notificationsService.notifyCreditsStateSafe(userId, gate.balance);
    } catch (err) {
      console.error("[chat] 积分通知投递失败:", err);
    }
    return Response.json(
      { error: { code: "INSUFFICIENT_CREDITS", message: "积分余额不足，无法生成" } },
      { status: 402 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "请求体需为 JSON" } }, { status: 400 });
  }
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: parsed.error.message } }, { status: 400 });
  }

  const { sessionId, message } = parsed.data;
  // 入口初筛留在 web：命中必须在 user 行落库之前拒绝，creation 拿不到这个机会。
  const blocked = screenInput(message);
  if (blocked) {
    return Response.json({ error: { code: "BLOCKED", message: blocked } }, { status: 400 });
  }

  const sessionRepo = createSessionRepo();
  const session = await sessionRepo.get(sessionId, userId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }
  const agentId = session.agentId ?? parsed.data.agentId;

  // 引用注入：批量取资产并归属校验（存在、属于当前用户、属于当前会话），任一不满足整体拒绝。
  const referenceIds = [...new Set(parsed.data.referenceAssetIds ?? [])];
  const assetRepo = createAssetRepo();
  const referenceAssets =
    referenceIds.length > 0 ? await assetRepo.getManyByIds(referenceIds) : [];
  if (referenceIds.length > 0) {
    const owned = new Set(
      referenceAssets
        .filter((a) => a.userId === userId && a.sessionId === sessionId)
        .map((a) => a.id),
    );
    if (referenceIds.some((id) => !owned.has(id))) {
      return Response.json(
        { error: { code: "INVALID_REFERENCE", message: "引用的图片不存在或无权使用" } },
        { status: 400 },
      );
    }
  }
  // 本轮模型可见文本 = 原文 + 引用块（creation 用同一份实现拼装自己的输入）。
  const userText =
    message + (referenceAssets.length > 0 ? `\n\n${buildReferenceBlock(referenceAssets)}` : "");

  // 首条用户消息自动命名：仅当标题为空时截取前 20 字（手动命名与后续消息不覆盖；失败不阻断聊天）
  if (session.title == null) {
    try {
      await sessionRepo.rename(sessionId, message.slice(0, 20));
    } catch {
      // 自动命名失败仅影响标题展示，不阻断本轮对话
    }
  }

  const messageRepo = createMessageRepo();
  // user 消息双视图落库：content 列存原文（UI 渲染），transcript 存 LLM 视图。
  // vision 回合额外带图片引用块（清洗后只留 assetId/url 占位，无 base64）；
  // 能力查询失败时退化为纯文本口径，不阻断本轮。
  const vision = (await isVisionAgent(agentId)) ?? false;
  const userMessage: UserMessage = {
    role: "user",
    timestamp: Date.now(),
    content:
      vision && referenceAssets.length > 0
        ? [
            { type: "text", text: userText },
            ...visionImageParts(referenceAssets),
          ]
        : userText,
  };
  const userRow = await messageRepo.create({
    sessionId,
    userId,
    role: "user",
    content: message,
    transcript: sanitizeTranscript([userMessage]),
  });

  const runId = randomUUID();
  const { baseUrl, internalToken } = getCreationConfig();
  const ac = new AbortController();
  const onClientAbort = () => ac.abort();
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": internalToken },
      body: JSON.stringify({
        runId,
        userId,
        sessionId,
        agentId,
        message,
        userMessageId: userRow.id,
        referenceAssetIds: referenceIds,
      }),
      signal: ac.signal,
    });
  } catch (err) {
    // 客户端已经走了：不再回滚（creation 可能已开跑并写入 assistant 行）
    if (!req.signal.aborted) {
      console.error("[chat] creation 不可达:", err);
      await rollbackUserMessage(messageRepo, sessionId, userRow.id);
    }
    return Response.json(
      { error: { code: "CREATION_UNAVAILABLE", message: "创作服务不可用，请稍后重试" } },
      { status: 503 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const failure = await readUpstreamError(upstream);
    await rollbackUserMessage(messageRepo, sessionId, userRow.id);
    return Response.json(
      { error: { code: failure.code, message: failure.message } },
      { status: upstream.status === 401 ? 502 : upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** 引用图 → transcript 的图片块（只留引用线索，字节由 creation 读取，绝不进 web 落库路径）。 */
function visionImageParts(assets: readonly Asset[]) {
  return assets
    .filter((a) => a.mimeType.startsWith("image/"))
    .map((a) => ({
      type: "image" as const,
      data: "",
      mimeType: a.mimeType,
      assetId: a.id,
      url: `/files/${a.storageKey}`,
    }));
}

/**
 * 已落库 user 行的回滚：仅当该会话**没有任何 assistant 行**时删除。
 * 这是设计里明确接受的退化窗口（有 user 消息、无回复）的唯一收敛点。
 */
async function rollbackUserMessage(
  repo: MessageRepo,
  sessionId: string,
  messageId: string,
): Promise<void> {
  try {
    const rows = await repo.list(sessionId);
    if (rows.some((r) => r.role === "assistant")) return;
    await repo.remove(messageId);
  } catch (err) {
    console.error("[chat] 回滚 user 消息失败:", err);
  }
}

async function readUpstreamError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return {
      code: body.error?.code ?? "CREATION_ERROR",
      message: body.error?.message ?? "创作服务返回错误",
    };
  } catch {
    return { code: "CREATION_ERROR", message: "创作服务返回错误" };
  }
}
