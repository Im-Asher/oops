/**
 * 聊天面板与画布共享的前端消息类型。
 * 对应 /api/sessions/:id 返回的 UIMessage 结构与 /api/chat 的 SSE 事件。
 */

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; url: string; assetId: string }
    | { type: "file"; url: string }
  >;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export interface SessionInfo {
  id: string;
  agentId?: string | null;
  title?: string | null;
}

export type ChatEvent =
  | { type: "message_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string; name: string; details: Record<string, unknown> | null }
  | { type: "finish"; stopReason: string }
  | { type: "error"; message: string };
