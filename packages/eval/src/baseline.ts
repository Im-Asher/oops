import type { Failure } from "./taxonomy";

export interface CaseResultLike {
  id: string;
  failures: Failure[];
}
export interface ReportLike {
  results: CaseResultLike[];
}

/** L4 不进闸门：评分抖动不适合当回归门。 */
export const NON_BLOCKING: ReadonlySet<string> = new Set(["judge_low"]);

/**
 * 解析 baseline.json 文本。[--update-baseline 写出的是 `{ results: [...] }`]
 * 解析失败或结构不对必须显式报错（CLI 转成 exit 2），否则「基线坏了」会静默变成「不阻断」。
 */
export function parseBaseline(text: string): ReportLike {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`baseline.json 不是合法 JSON：${(err as Error).message}`);
  }
  if (!json || typeof json !== "object" || !Array.isArray((json as { results?: unknown }).results)) {
    throw new Error("baseline.json 结构不对：缺少 results 数组");
  }
  const results = (json as { results: unknown[] }).results;
  for (const r of results) {
    const item = r as { id?: unknown; failures?: unknown } | null;
    if (!item || typeof item.id !== "string" || !Array.isArray(item.failures)) {
      throw new Error("baseline.json 结构不对：results 每项需有字符串 id 与 failures 数组");
    }
  }
  return json as ReportLike;
}

export interface CompareResult {
  blocking: boolean;
  regressions: { id: string; code: string }[];
  fixed: { id: string; code: string }[];
}

export function compareToBaseline(input: { baseline: ReportLike; current: ReportLike }): CompareResult {
  const before = new Map(
    input.baseline.results.map((r) => [r.id, new Set(r.failures.map((f) => f.code))]),
  );
  const regressions: { id: string; code: string }[] = [];
  const fixed: { id: string; code: string }[] = [];

  for (const r of input.current.results) {
    const prev = before.get(r.id);
    const now = new Set(r.failures.map((f) => f.code));
    if (!prev) continue; // 新 case：无基线可比较，只记录
    for (const code of now) if (!prev.has(code)) regressions.push({ id: r.id, code });
    for (const code of prev) if (!now.has(code)) fixed.push({ id: r.id, code });
  }

  return {
    blocking: regressions.some((r) => !NON_BLOCKING.has(r.code)),
    regressions,
    fixed,
  };
}
