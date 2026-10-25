import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

/**
 * LLM 视图（messages.transcript 列）的序列化 / 反序列化。
 *
 * 归属 `@oops/llm` 而不是某个 app：写侧清洗由 web（user 行）与 creation（assistant 行）
 * 共用，读侧回放只在 creation。放在这里让两个进程 import 同一份实现，禁止各存一份。
 *
 * 硬约束：thinking 块不持久化；base64 图片不落库（写入时即文本化）。
 */
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
 * user 消息图片块的留存文本：ImageContent 本体不含资产引用，引用线索由组装侧
 * （web 路由层）以扩展字段附带——留存带 assetId/url 的占位文本，绝不携带 base64。
 */
function userImagePlaceholder(c: ImageContent): TextContent {
  const ext = c as ImageContent & { assetId?: unknown; url?: unknown };
  const assetId = typeof ext.assetId === "string" ? ext.assetId : undefined;
  const url = typeof ext.url === "string" ? ext.url : undefined;
  const asset = assetId ? ` (assetId: ${assetId})` : "";
  return { type: "text", text: `[图片附件: ${url ?? "(无引用信息)"}${asset}]` };
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
      content: message.content.map((c) => (isImageContent(c) ? userImagePlaceholder(c) : c)),
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
