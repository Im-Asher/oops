import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createMessageRepo, type MessageRepo } from "@/server/db/message.repo";
import { getChatModel, getChatModels } from "@/server/infra/providers/llm";
import { agentRegistry } from "./agents/registry";
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
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
  repos?: { message: MessageRepo };
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

  const model = getChatModel();
  const tools = agentRegistry.getAgentTools(args.agentId);
  const messageRepo = args.repos?.message ?? createMessageRepo();

  // 重建回放历史：拼接会话 transcript，排除本轮 user 行（其文本由 prompt() 注入），
  // 消息数硬上限兜底（compact 之前的最后防线）
  const rows = await messageRepo.list(args.sessionId);
  const history = buildReplayHistory(rows, args.userMessageId, REPLAY_MAX_MESSAGES);

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
            toolResults.push(details as Record<string, unknown>);
          }
        }
        break;
      case "agent_end":
        args.onEvent({ type: "finish", stopReason: "stop" });
        break;
    }
  });

  try {
    await agent.prompt(args.userText);
  } catch (err) {
    args.onEvent({ type: "error", message: (err as Error)?.message ?? "生成失败" });
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
    });
  }
}
