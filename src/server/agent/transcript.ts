import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
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
      // 生成图与编辑导出图都渲染为图片 part；后者无 prompt/model 血缘。
      if ((tc?.type === "generate_image" || tc?.type === "edited_image") && tc.url) {
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

// ---------------------------------------------------------------------------
// LLM 视图（transcript 列）：写侧清洗 + 序列化。
// 硬约束：thinking 块不持久化；base64 图片不落库（写入时即文本化）。
// ---------------------------------------------------------------------------

export const TRANSCRIPT_VERSION = 1 as const;

export interface SerializedTranscript {
  v: typeof TRANSCRIPT_VERSION;
  messages: Message[];
}

function isImageContent(c: unknown): c is ImageContent {
  return typeof c === "object" && c !== null && (c as { type?: string }).type === "image";
}

/** 从工具结果 details 中提取图片引用（generate_image / 编辑导出等均落 url/assetId）。 */
function imageRefFromDetails(details: unknown): { url?: string; assetId?: string } {
  if (typeof details !== "object" || details === null) return {};
  const d = details as { url?: unknown; assetId?: unknown };
  return {
    url: typeof d.url === "string" ? d.url : undefined,
    assetId: typeof d.assetId === "string" ? d.assetId : undefined,
  };
}

function imagePlaceholder(ref: { url?: string; assetId?: string }): TextContent {
  const url = ref.url ?? "(无引用信息)";
  const asset = ref.assetId ? ` (assetId: ${ref.assetId})` : "";
  return { type: "text", text: `[已生成图片: ${url}${asset}]` };
}

/**
 * 清洗单条 message：assistant 剥 thinking；user/toolResult 的图片块文本化。
 * 注意：details 字段原样保留（当前工具契约下 details 只含小型元数据，图片 base64
 * 只出现在 content 中——新增工具 MUST NOT 把图片数据放进 details，否则绕过清洗）。
 */
function sanitizeMessage(message: Message): Message {
  if (message.role === "assistant") {
    return {
      ...message,
      content: message.content.filter((c) => c.type !== "thinking"),
    };
  }
  if (message.role === "toolResult") {
    const ref = imageRefFromDetails(message.details);
    return {
      ...message,
      content: message.content.map((c) => (isImageContent(c) ? imagePlaceholder(ref) : c)),
    };
  }
  if (message.role === "user" && Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map((c) =>
        isImageContent(c) ? { type: "text", text: "[图片附件]" } : c,
      ),
    };
  }
  return message;
}

/** 校验序列化 blob 是否为当前版本的 transcript（供读取侧容错，坏数据返回空）。 */
export function isSerializedTranscript(raw: unknown): raw is SerializedTranscript {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as { v?: unknown; messages?: unknown };
  return r.v === TRANSCRIPT_VERSION && Array.isArray(r.messages);
}

export interface TranscriptRowLike {
  id?: string | null;
  transcript?: unknown;
}

/**
 * 读取侧重建：拼接各落库行的 transcript 为回放历史（按行序，即时间升序）。
 * - excludeMessageId：本轮 user 行（其文本将由 prompt() 注入，不重复）
 * - 无 transcript 的行（旧数据/清洗失败的坏数据）整行跳过，不抛错
 * - maxMessages：回放消息数硬上限（兜底），从最新往旧截取，截断对齐行边界
 *   （不拆行内消息组；已收集非空时才截断——单行自身超限时仍整行保留，
 *   避免"空历史"退化，宁超不缺）
 */
export function buildReplayHistory(
  rows: TranscriptRowLike[],
  excludeMessageId?: string,
  maxMessages?: number,
): Message[] {
  const collected: Message[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (excludeMessageId && row.id && row.id === excludeMessageId) continue;
    if (!isSerializedTranscript(row.transcript)) continue;
    const messages = row.transcript.messages;
    if (
      maxMessages !== undefined &&
      collected.length > 0 &&
      collected.length + messages.length > maxMessages
    ) {
      break;
    }
    collected.unshift(...messages);
  }
  return collected;
}

/**
 * 写侧清洗 + 序列化：深拷贝后剥 thinking、图片文本化，附加版本标记。
 * 产物将存入 messages.transcript（jsonb），MUST NOT 含 base64 数据。
 */
export function sanitizeTranscript(messages: Message[]): SerializedTranscript {
  const cleaned = structuredClone(messages).map(sanitizeMessage);
  return { v: TRANSCRIPT_VERSION, messages: cleaned };
}
