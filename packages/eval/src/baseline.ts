import type { Failure } from "./taxonomy";

export interface CaseResultLike {
  id: string;
  failures: Failure[];
}
export interface ReportLike {
  results: CaseResultLike[];
}

/** L4 不进闸门：评分抖动不适合当回归门。 */
const NON_BLOCKING: ReadonlySet<string> = new Set(["judge_low"]);

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
