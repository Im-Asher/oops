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
    /** 当轮流式专用：思考内容聚合（streaming 标记驱动折叠态），不落库 */
    | { type: "thinking"; text: string; streaming: boolean }
    /** 当轮流式专用：工具执行状态行，完成时被结果或移除取代，不落库 */
    | { type: "tool_status"; id: string; label: string }
  >;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  /** 头像徽标 emoji。 */
  icon: string;
  /** 空会话灵感卡示例需求文案。 */
  presets: string[];
  tools: string[];
}

export interface SessionInfo {
  id: string;
  agentId?: string | null;
  title?: string | null;
  /** ISO 时间戳，用于侧栏时间分组与排序。 */
  updatedAt?: string;
}

export type ChatEvent =
  | { type: "message_delta"; text: string }
  | { type: "thinking_start"; id: string }
  | { type: "thinking_delta"; id: string; text: string }
  | { type: "thinking_end"; id: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string; name: string; details: Record<string, unknown> | null }
  | { type: "finish"; stopReason: string }
  | { type: "error"; message: string };
