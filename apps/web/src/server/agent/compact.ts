import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "@earendil-works/pi-ai";
import { buildReplayHistory, isSerializedTranscript, type TranscriptRowLike } from "./transcript";

const here = dirname(fileURLToPath(import.meta.url));

/** 摘要骨架 prompt（外置文件，遵循 prompt 不内联约定） */
export const SUMMARY_PROMPT = readFileSync(join(here, "definitions", "prompts", "session-summary.md"), "utf8");

/** 字符近似 token 估算（中文 ~1.5 字/token），阈值误差由 last-40 兜底吸收。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5);
}

/** 超过此估算 token 量触发 compact */
export const COMPACT_TRIGGER_TOKENS = 30_000;
/** compact 后保留近期原文的行预算（摘要 + 近期原文的目标上限） */
export const COMPACT_TARGET_TOKENS = 10_000;

export interface CompactDeps {
  /** LLM 摘要调用（骨架 prompt + 摘要输入文本 → 新摘要） */
  summarize: (systemPrompt: string, input: string) => Promise<string>;
  /** 摘要与水位线落库 */
  updateSummary: (
    sessionId: string,
    input: { summary: string; summarizedUpTo: string | null },
  ) => Promise<unknown>;
}

export interface CompactInput {
  sessionId: string;
  /** 会话全部消息行（时间升序，含 transcript），来自 messageRepo.list */
  rows: TranscriptRowLike[];
  currentSummary: string | null;
  currentWatermark: string | null;
  /** 本轮 user 行：不参与压缩范围，也不会被水位线越过 */
  excludeMessageId?: string;
  deps: CompactDeps;
}

export interface CompactResult {
  compacted: boolean;
  /** compact 后应作为前缀使用的摘要（未触发时为现有摘要） */
  summary: string | null;
  /** compact 后水位线（未触发时为现有水位线） */
  watermark: string | null;
}

/** 压缩范围界定：从最新往旧保留行直到 target 预算，其余较老行进压缩范围。
 *  行边界天然对齐完整轮；坏行（无/未知版本 transcript）既不占预算也不进摘要。
 *  返回的水位线 = 被压缩行中最新的行 id（不存在时为 null）。 */
export function selectCompactionRange(
  rows: TranscriptRowLike[],
  excludeMessageId: string | undefined,
  targetTokens: number,
): { compactedRows: TranscriptRowLike[]; watermark: string | null } {
  const valid: { row: TranscriptRowLike; text: string }[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (excludeMessageId && row.id && row.id === excludeMessageId) continue;
    if (!isSerializedTranscript(row.transcript)) continue;
    valid.push({ row, text: JSON.stringify(row.transcript.messages) });
  }

  let budget = 0;
  let cursor = 0;
  while (cursor < valid.length) {
    const cost = estimateTokens(valid[cursor].text);
    if (budget + cost > targetTokens && budget > 0) break;
    budget += cost;
    cursor++;
  }
  // valid 为最新→最旧；cursor 之后均为被压缩行，reverse 恢复时间升序（供摘要输入），
  // 升序的最后一项即压缩范围里最新的行 = 新水位线
  const compactedRows = valid.slice(cursor).map((v) => v.row).reverse();
  const newestCompacted = compactedRows[compactedRows.length - 1];
  return { compactedRows, watermark: newestCompacted?.id ?? null };
}

function indexOfRow(rows: TranscriptRowLike[], id: string | null): number {
  return id === null ? -1 : rows.findIndex((r) => r.id === id);
}

/**
 * 会话历史 compact：有效上下文（摘要 + 水位线后原文）估算超过触发阈值时，
 * 把范围内较早轮次压缩为骨架式摘要并推进水位线。
 * - 压缩范围：有有效摘要时仅水位线之后的行（更早内容已由摘要承载）——因此触发估算
 *   基于有效上下文，压缩后不会每轮重复触发；摘要缺失/空白（或水位线行已不存在）时，
 *   水位线前行为"孤儿"，取全量行以便幂等重建（spec：仅凭原文重建等价摘要）
 * - 幂等可重算：原文永不删除，摘要可从原文重建
 * - 水位线单调推进：新水位线在行序中必须比现水位线更靠后，否则拒绝落库（防并发回退）；
 *   孤儿重建模式允许同水位线重算
 * - 本轮 user 行（excludeMessageId）不参与压缩，也不会被水位线越过
 */
export async function compactSessionHistory(input: CompactInput): Promise<CompactResult> {
  const { sessionId, rows, currentSummary, currentWatermark, excludeMessageId, deps } = input;

  const hasValidSummary = !!currentSummary?.trim();
  const currentIdx = indexOfRow(rows, currentWatermark);
  const scopedRows =
    hasValidSummary && currentIdx >= 0 ? rows.slice(currentIdx + 1) : rows;

  // 触发估算 = 有效上下文（摘要 + 水位线后历史原文 + 本轮 user 文本）。
  // 本轮行虽由 prompt() 注入而非回放，但同样进入 LLM 上下文，必须计入——
  // 否则单条超长消息会系统性漏触发（其体量要到下一轮才被当作历史看到）
  const replay = buildReplayHistory(scopedRows);
  const estimated =
    estimateTokens(JSON.stringify(replay)) +
    (currentSummary ? estimateTokens(currentSummary) : 0);
  if (estimated <= COMPACT_TRIGGER_TOKENS) {
    return { compacted: false, summary: currentSummary, watermark: currentWatermark };
  }

  const { compactedRows, watermark } = selectCompactionRange(
    scopedRows,
    excludeMessageId,
    COMPACT_TARGET_TOKENS,
  );
  if (!watermark) {
    // 无有效行可压缩（理论边界），保守放弃本轮压缩
    return { compacted: false, summary: currentSummary, watermark: currentWatermark };
  }

  const newIdx = indexOfRow(rows, watermark);
  if (newIdx < currentIdx || (newIdx === currentIdx && hasValidSummary)) {
    return { compacted: false, summary: currentSummary, watermark: currentWatermark };
  }

  const summaryInput = [
    hasValidSummary ? `<旧摘要>\n${currentSummary}\n</旧摘要>` : "",
    ...compactedRows.map((row) =>
      JSON.stringify((row.transcript as { messages: Message[] }).messages),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const summary = await deps.summarize(SUMMARY_PROMPT, summaryInput);
  // 空摘要绝不落库：否则水位线推进 + 前缀缺失 = 被压缩轮次从上下文彻底丢失
  if (!summary.trim()) {
    return { compacted: false, summary: currentSummary, watermark: currentWatermark };
  }
  await deps.updateSummary(sessionId, { summary, summarizedUpTo: watermark });
  return { compacted: true, summary, watermark };
}

/** 摘要作为回放前缀消息注入（水位线前的内容由它替代，不占 last-40 预算）。 */
export function summaryPrefixMessage(summary: string): Message {
  return {
    role: "user",
    content: `<会话摘要>\n以下是本会话较早轮次的摘要（原文已压缩，资产引用仍有效）：\n${summary}\n</会话摘要>`,
    timestamp: Date.now(),
  };
}
