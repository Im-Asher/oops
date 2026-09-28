import { createMessageRepo } from "@/server/db/message.repo";

export type UIMessagePart =
  | { type: "text"; text: string }
  | {
      type: "image";
      url: string;
      assetId: string;
      prompt?: string;
      model?: string;
      size?: string;
    }
  | { type: "file"; url: string; assetId?: string };

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: UIMessagePart[];
}

interface StoredToolCall {
  type?: string;
  url?: string;
  assetId?: string;
  prompt?: string;
  model?: string;
  size?: string;
}

/** 把落库消息（content + toolCalls）确定性重建为可直接渲染的 UIMessage parts（零转换）。 */
export function toUIMessage(
  id: string,
  role: "user" | "assistant" | "system",
  content: string,
  toolCalls: unknown,
): UIMessage {
  const parts: UIMessagePart[] = [];
  if (content) parts.push({ type: "text", text: content });

  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as StoredToolCall[]) {
      if (tc?.type === "generate_image" && tc.url) {
        parts.push({
          type: "image",
          url: tc.url,
          assetId: tc.assetId ?? "",
          prompt: tc.prompt,
          model: tc.model,
          size: tc.size,
        });
      } else if (tc?.type === "file" && tc.url) {
        parts.push({ type: "file", url: tc.url, assetId: tc.assetId });
      }
    }
  }

  return { id, role: role === "system" ? "assistant" : role, parts };
}

/** 读取会话的全部消息并重建为 UIMessage 列表（按时间升序）。 */
export async function loadSessionMessages(sessionId: string): Promise<UIMessage[]> {
  const repo = createMessageRepo();
  const rows = await repo.list(sessionId);
  return rows.map((row, i) =>
    toUIMessage(row.id ?? `m${i}`, row.role as "user" | "assistant" | "system", row.content ?? "", row.toolCalls),
  );
}
