import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createMessageRepo, type MessageRepo } from "@/server/db/message.repo";
import { createSessionRepo, type SessionRepo } from "@/server/db/session.repo";
import { getChatModelForRole, getChatModels } from "@/server/infra/providers/llm";
import { agentRegistry } from "./registry";
import { compactSessionHistory, summaryPrefixMessage } from "./compact";
import { toolRegistry } from "./tools/registry";
import { buildReplayHistory, sanitizeTranscript } from "./transcript";
import type { SseEvent } from "./types";

/** 回放消息数硬上限（tasks.md 3.2：任何情况下不爆炸的最后防线） */
const REPLAY_MAX_MESSAGES = 40;

export interface RunAgentArgs {
  sessionId: string;
  agentId: string;
  userText: string;
  // 本轮 user 消息的落库行 id：重建历史时排除该行，避免与 prompt() 重复注入
  userMessageId: string;
  // 已认证用户（require-user 解析）：贯穿工具上下文与落库归属
  userId: string;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
  repos?: { message: MessageRepo; session?: SessionRepo };
}

/**
 * 运行一次 Agent 回合：把 agentLoop 生命周期事件桥接为 SSE 事件，
 * 并在回合结束时把 assistant 文本与工具结果落库（事件即持久化的回合级实现）。
 */
export async function runAgent(args: RunAgentArgs): Promise<void> {
  const def = agentRegistry.get(args.agentId);
  if (!def) {
    args.onEvent({ type: "error", message: `未知 Agent：${args.agentId}` });
    return;
  }

  // 按角色装配（llm-assembly spec）：main 带该 Agent 的模型能力声明，summarizer 走全局装配。
  // 装配层配置错误（供应商未登记/覆盖模型不存在/能力不满足）显式回喂 SSE，回合不执行。
  let model: ReturnType<typeof getChatModelForRole>;
  let summaryModel: ReturnType<typeof getChatModelForRole>;
  try {
    model = getChatModelForRole("main", def.models);
    summaryModel = getChatModelForRole("summarizer");
  } catch (err) {
    args.onEvent({
      type: "error",
      message: (err as Error)?.message ?? "模型配置错误",
    });
    return;
  }
  const tools = agentRegistry.getAgentTools(args.agentId, {
    userId: args.userId,
    sessionId: args.sessionId,
  });
  const messageRepo = args.repos?.message ?? createMessageRepo();
  const sessionRepo = args.repos?.session ?? createSessionRepo();

  const rows = await messageRepo.list(args.sessionId);

  // compact：被动触发（估算超阈值才压缩，同步执行；详见 design D3/D4）。
  // 失败降级：按现有摘要/水位线继续回放（原文未删、last-40 兜底仍在），不中断用户回合
  const session = await sessionRepo.get(args.sessionId, args.userId);
  let compactResult: Awaited<ReturnType<typeof compactSessionHistory>> = {
    compacted: false,
    summary: session?.summary ?? null,
    watermark: session?.summarizedUpTo ?? null,
  };
  try {
    compactResult = await compactSessionHistory({
      sessionId: args.sessionId,
      rows,
      currentSummary: session?.summary ?? null,
      currentWatermark: session?.summarizedUpTo ?? null,
      excludeMessageId: args.userMessageId,
      deps: {
        summarize: async (systemPrompt, input) => {
          const result = await getChatModels().completeSimple(summaryModel, {
            systemPrompt,
            messages: [{ role: "user", content: input, timestamp: Date.now() }],
          });
          // completeSimple 对 provider 错误 resolve 而非 reject，必须显式检查
          if (result.stopReason === "error" || result.stopReason === "aborted") {
            throw new Error(`摘要生成失败：${result.errorMessage ?? result.stopReason}`);
          }
          return result.content
            .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
            .map((c) => c.text)
            .join("")
            .trim();
        },
        updateSummary: (id, input) => sessionRepo.updateSummary(id, input),
      },
    });
  } catch (err) {
    console.error("[compact] 摘要压缩失败，本轮降级跳过:", err);
  }

  // 重建回放历史：水位线之后的行回放原文（水位线前由摘要替代），套 last-40 兜底，
  // 排除本轮 user 行（其文本由 prompt() 注入）。
  // 摘要有效性与 compact 口径一致：空白摘要视同无摘要，此时按水位线切片会丢失水位线前内容
  const summary = compactResult.summary?.trim() ? compactResult.summary : null;
  const watermarkIdx =
    summary && compactResult.watermark
      ? rows.findIndex((r) => r.id === compactResult.watermark)
      : -1;
  const afterRows = watermarkIdx >= 0 ? rows.slice(watermarkIdx + 1) : rows;
  let history = buildReplayHistory(afterRows, args.userMessageId, REPLAY_MAX_MESSAGES);
  if (summary) {
    history = [summaryPrefixMessage(summary), ...history];
  }

  const agent = new Agent({
    streamFn: (m, c, o) => getChatModels().streamSimple(m, c, o),
    initialState: { model, systemPrompt: def.systemPrompt, tools, messages: history },
    beforeToolCall: async (ctx) => {
      if (!toolRegistry.has(ctx.toolCall.name)) {
        return { block: true };
      }
      return undefined;
    },
  });

  let assistantText = "";
  const toolResults: Record<string, unknown>[] = [];
  // 回合基线：state.messages 含回放的历史（3.1 起 initialState.messages 非空），
  // 落库只取 prompt 之后新增的部分，避免 assistant 行携带全历史
  const turnBaseline = agent.state.messages.length;

  agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          assistantText += ame.delta;
          args.onEvent({ type: "message_delta", text: ame.delta });
        } else if (ame.type === "thinking_start") {
          // 思考内容仅流式转发（前端可折叠展示），不累积、不落库——
          // 持久化清洗由 sanitizeTranscript 在回合结束统一剥离
          args.onEvent({ type: "thinking_start", id: String(ame.contentIndex) });
        } else if (ame.type === "thinking_delta") {
          args.onEvent({ type: "thinking_delta", id: String(ame.contentIndex), text: ame.delta });
        } else if (ame.type === "thinking_end") {
          args.onEvent({ type: "thinking_end", id: String(ame.contentIndex) });
        }
        break;
      }
      case "tool_execution_start":
        args.onEvent({
          type: "tool_start",
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_end":
        args.onEvent({
          type: "tool_end",
          id: event.toolCallId,
          name: event.toolName,
          details: ((event.result as { details?: unknown })?.details as Record<string, unknown>) ?? null,
        });
        if (event.result && typeof event.result === "object") {
          const details = (event.result as { details?: unknown }).details;
          if (details && typeof details === "object") {
            // 落库需带工具名作为 type：toUIMessage 按 type 识别图片 part，缺了刷新后图片丢失
            toolResults.push({ type: event.toolName, ...(details as Record<string, unknown>) });
          }
        }
        break;
      case "agent_end":
        args.onEvent({ type: "finish", stopReason: args.signal.aborted ? "aborted" : "stop" });
        break;
    }
  });

  // 中断接线：route 层 signal（客户端断开或用户点停止）→ 真停 agentLoop。
  // 实测（见 change notes abort-probe）：abort 后 prompt() 正常 resolve，state 留下
  // stopReason="aborted" 的部分 assistant 消息 → 下方统一落库即天然部分落库。
  const onAbort = () => agent.abort();
  if (args.signal.aborted) {
    onAbort();
  } else {
    args.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await agent.prompt(args.userText);
  } catch (err) {
    // 中断引发的异常不外推（SSE 已断，收尾事件无法也无需送达），仅吞掉
    if (!args.signal.aborted) {
      args.onEvent({ type: "error", message: (err as Error)?.message ?? "生成失败" });
    }
  } finally {
    args.signal.removeEventListener("abort", onAbort);
  }

  if (assistantText || toolResults.length > 0) {
    // LLM 视图：从 agent 状态取本轮增量消息（权威 transcript）。user 消息已随 route 层
    // 落库（user 行），此处只收 assistant 与工具结果；写入前经清洗（无 thinking/无 base64）。
    const turnMessages = agent.state.messages
      .slice(turnBaseline)
      .filter((m) => m.role === "assistant" || m.role === "toolResult");
    await messageRepo.create({
      sessionId: args.sessionId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolResults.length ? toolResults : undefined,
      transcript: turnMessages.length > 0 ? sanitizeTranscript(turnMessages) : undefined,
      userId: args.userId,
    });
  }
}
