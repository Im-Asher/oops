import type { CaseResult } from "./report";
import type { Failure, FailureCode } from "./taxonomy";

/**
 * 把同一个 case 的 N 次结果合并成一条。
 * - 失败码：命中次数 > N/2 才算失败（多数票），detail 追加「（x/N 次）」保留强度信息
 * - L4：取中位数（偶数次取中间两个的较小者，偏保守）
 * - imageUrl / rawText：取第一次成功的；toolCalls、notes 取并集去重
 */
export function mergeRuns(runs: CaseResult[]): CaseResult {
  if (runs.length === 0) throw new Error("mergeRuns 至少需要 1 次运行结果");
  // 单跑模式原样返回：不让报告里凭空多出「（1/1 次）」这类噪声
  if (runs.length === 1) return runs[0];

  const first = runs[0];
  const failures = mergeFailures(runs);
  const kept = new Set(failures.map((f) => f.code));

  return {
    id: first.id,
    agent: first.agent,
    // 真实耗时：N 次是串行跑的，加起来才是这轮实际花掉的时间
    durationMs: runs.reduce((sum, r) => sum + r.durationMs, 0),
    imageUrl: firstSuccess(runs, (r) => r.imageUrl),
    failures,
    l4: mergeL4(runs),
    toolCalls: union(runs.flatMap((r) => r.toolCalls)),
    // rawText 取第一次成功那轮的文字：合并多轮文本只会让报告更难读
    rawText: pickRawText(runs),
    ...(() => {
      // 备注解释的是「为什么某项没判」。只在对应失败仍是多数结论时保留，
      // 否则会出现「本 case PASS，但备注说跳过了 L3」这种自相矛盾的报告。
      const notes = union(
        runs
          .filter((r) => r.failures.some((f) => kept.has(f.code)))
          .flatMap((r) => r.notes ?? []),
      );
      return notes.length > 0 ? { notes } : {};
    })(),
  };
}

/**
 * 多数票：出现次数严格大于 N/2 才算失败（N=2 时要两次都失败，宁松不严）。
 * 同一次里同一码有多条 detail 只算一次命中，否则单次噪声会被放大成「多数」。
 */
function mergeFailures(runs: CaseResult[]): Failure[] {
  const n = runs.length;
  const order: FailureCode[] = [];
  const details = new Map<FailureCode, string[]>();
  const hits = new Map<FailureCode, number>();

  for (const r of runs) {
    const seen = new Set<FailureCode>();
    for (const f of r.failures) {
      if (!details.has(f.code)) {
        details.set(f.code, []);
        order.push(f.code);
      }
      details.get(f.code)!.push(f.detail);
      if (seen.has(f.code)) continue;
      seen.add(f.code);
      hits.set(f.code, (hits.get(f.code) ?? 0) + 1);
    }
  }

  return order
    .filter((code) => (hits.get(code) ?? 0) > n / 2)
    .map((code) => ({
      code,
      // detail 取首次出现的原文，再挂上次数：既保留具体数值（溢出 135px），也保留稳定性
      detail: `${details.get(code)![0]}（${hits.get(code)}/${n} 次）`,
    }));
}

/** 中位数只统计有分数的几次（L4 解析失败时 score 为 null）。偶数个取较小者。 */
function mergeL4(runs: CaseResult[]): CaseResult["l4"] {
  const scored = runs
    .map((r) => r.l4)
    .filter((l): l is { score: number; reason: string } => l !== null && l.score !== null)
    .sort((a, b) => a.score - b.score);
  if (scored.length === 0) return null;
  const median = scored[(scored.length - 1) >> 1];
  return { score: median.score, reason: median.reason };
}

/**
 * 合并后的原文：优先取无阻断性失败那一轮的文字（模型正常收尾），
 * 全都失败才退回到第一次有文字的那轮——失败那轮的文字更容易误导人。
 */
function pickRawText(runs: CaseResult[]): string {
  const clean = runs.find((r) => r.failures.length === 0 && r.rawText !== "");
  if (clean) return clean.rawText;
  return firstSuccess(runs, (r) => (r.rawText === "" ? null : r.rawText)) ?? "";
}

/** 取第一个非空值：成功那一轮的产物才有诊断价值。 */
function firstSuccess<T>(runs: CaseResult[], pick: (r: CaseResult) => T | null): T | null {
  for (const r of runs) {
    const v = pick(r);
    if (v !== null) return v;
  }
  return null;
}

function union(list: string[]): string[] {
  return [...new Set(list)];
}
