import { isBlocking, type CaseResult } from "./report";

/**
 * 解析 `--repeat=N`。默认 1；非法/≤0/非整数一律回落 1 而不是抛错——
 * 一个手滑的参数不该让半小时的评测在启动时就崩掉。
 */
export function parseRepeat(args: string[]): number {
  const raw = args.find((a) => a.startsWith("--repeat="))?.slice("--repeat=".length);
  if (raw === undefined) return 1;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** 跑完一轮的进度尾巴：PASS / FAIL 失败码，单跑与多跑共用同一套判定文案。 */
export function runLabel(r: CaseResult): string {
  return isBlocking(r) ? `FAIL ${r.failures.map((f) => f.code).join(",")}` : "PASS";
}

/** 合并后的一行摘要，失败码带上「x/N 次」的次数，单跑模式不输出这一行。 */
export function mergeLabel(r: CaseResult): string {
  const base = runLabel(r);
  const counts = r.failures.map((f) => f.detail.match(/（\d+\/\d+ 次）$/)?.[0] ?? "");
  return counts.some((x) => x !== "") ? `${base}${counts.join("")}` : base;
}
