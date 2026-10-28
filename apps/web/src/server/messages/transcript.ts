import { createMessageRepo } from "@oops/db/message.repo";

/**
 * 落库消息 → 前端渲染 parts 的重建（读侧，web 专有）。
 * LLM 视图的清洗/回放在 `@oops/llm/transcript`：web 写 user 行、creation 写 assistant 行，
 * 两个进程共用同一份实现，不要在这里再放一份。
 */
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
  | { type: "file"; url: string; assetId?: string }
  | { type: "options"; question: string; options: { label: string; description?: string }[] };

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
  question?: string;
  options?: { label?: string; description?: string }[];
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
      // 生成图、编辑导出图与海报渲染图都渲染为图片 part（同等地位：可选中引用、血缘、GC）。
      if (
        (tc?.type === "generate_image" || tc?.type === "edited_image" || tc?.type === "render_html") &&
        tc.url
      ) {
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
      } else if (tc?.type === "present_options" && typeof tc.question === "string" && tc.question && Array.isArray(tc.options)) {
        // 选项卡恢复：清洗非法项后仍有效才产出 part（坏数据整块忽略，不抛错）。
        const options = tc.options
          .filter((o) => typeof o?.label === "string" && o.label.length > 0)
          .map((o) => ({
            label: o.label as string,
            ...(typeof o.description === "string" && o.description ? { description: o.description } : {}),
          }));
        if (options.length > 0) {
          parts.push({ type: "options", question: tc.question, options });
        }
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
