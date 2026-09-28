import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/** SSE 事件：由 runtime 将 agentLoop 事件桥接为前端可消费的格式。 */
export type SseEvent =
  | { type: "message_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string; name: string; details: Record<string, unknown> | null }
  | { type: "finish"; stopReason: string }
  | { type: "error"; message: string };

/** 落库消息行：content 存文本，toolCalls 存结构化工具调用（generate_image 结果等）。 */
export interface PersistedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: unknown;
}

/** generate_image 工具结果回带的结构化信息，用于持久化与前端渲染。 */
export interface ImageGenDetails {
  assetId: string;
  url: string;
  prompt: string;
  model: string;
  size: string;
  provider: string;
  taskId: string;
}

export type { ImageContent, TextContent };
