import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createMessageRepo, type MessageRepo } from "@/server/db/message.repo";
import { getChatModel, getChatModels } from "@/server/infra/providers/llm";
import { agentRegistry } from "./agents/registry";
import { toolRegistry } from "./tools/registry";
import type { SseEvent } from "./types";

export interface RunAgentArgs {
  sessionId: string;
  agentId: string;
  userText: string;
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

  const agent = new Agent({
    streamFn: (m, c, o) => getChatModels().streamSimple(m, c, o),
    initialState: { model, systemPrompt: def.systemPrompt, tools },
    beforeToolCall: async (ctx) => {
      if (!toolRegistry.has(ctx.toolCall.name)) {
        return { block: true };
      }
      return undefined;
    },
  });

  let assistantText = "";
  const toolResults: Record<string, unknown>[] = [];

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
    await messageRepo.create({
      sessionId: args.sessionId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolResults.length ? toolResults : undefined,
    });
  }
}
