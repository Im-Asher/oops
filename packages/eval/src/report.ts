import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NON_BLOCKING } from "./baseline";
import { FAILURE_LABELS, type Failure, type FailureCode } from "./taxonomy";

export interface CaseResult {
  id: string;
  agent: string;
  durationMs: number;
  imageUrl: string | null;
  /** 只允许封闭分类，服务端开放错误码由 execute 侧收敛后写入。 */
  failures: Failure[];
  l4: { score: number | null; reason: string } | null;
  toolCalls: string[];
  rawText: string;
  /** 本轮被判定的前置条件不成立（如溢出导致跳过 L3），不是失败，但要让人知道为什么没判。 */
  notes?: string[];
}

export interface Report {
  runAt: string;
  total: number;
  passed: number;
  results: CaseResult[];
}

/** 本 case 是否只有非阻断性失败（目前仅 judge_low，即 L4 分数偏低）。 */
export function onlyNonBlocking(result: Pick<CaseResult, "failures">): boolean {
  return result.failures.length > 0 && result.failures.every((f) => NON_BLOCKING.has(f.code));
}

/**
 * 是否存在阻断性失败。只有 judge_low 的 case 不算失败：
 * L4 是审美评分，抖动不适合决定通过与否。
 */
export function isBlocking(result: Pick<CaseResult, "failures">): boolean {
  return result.failures.some((f) => !NON_BLOCKING.has(f.code));
}

export function countPassed(results: Pick<CaseResult, "failures">[]): number {
  return results.filter((r) => !isBlocking(r)).length;
}

export function summarize(report: Report): Record<string, number> {
  const byCode: Record<string, number> = {};
  for (const r of report.results) {
    for (const f of r.failures) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  }
  return byCode;
}

export function writeReport(dir: string, report: Report): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));

  const byCode = summarize(report);
  const lines = [
    `# 评测报告 ${report.runAt}`,
    "",
    `通过 ${report.passed}/${report.total}（仅 L4 评分偏低（\`judge_low\`）不算失败，明细中标注为非阻断）`,
    "",
    "## 失败分布",
    "",
    "| 分类 | 次数 |",
    "| --- | --- |",
    ...Object.entries(byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `| ${FAILURE_LABELS[code as FailureCode] ?? code} (\`${code}\`) | ${n} |`),
    "",
    "## 明细",
    "",
    "| case | 结果 | L4 | 耗时 | 产物 |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map((r) => {
      const codes = r.failures.map((f) => f.code).join(", ");
      const status =
        r.failures.length === 0
          ? "PASS"
          : onlyNonBlocking(r)
            ? `PASS（非阻断：${codes}）`
            : codes;
      return `| ${r.id} | ${status} | ${r.l4?.score ?? "-"} | ${r.durationMs}ms | ${r.imageUrl ?? "-"} |`;
    }),
    ...(() => {
      const noted = report.results.filter((r) => (r.notes?.length ?? 0) > 0);
      if (noted.length === 0) return [];
      return [
        "",
        "## 备注（未判定的前置条件）",
        "",
        ...noted.map((r) => `- ${r.id}：${(r.notes ?? []).join("；")}`),
      ];
    })(),
  ];
  const md = join(dir, "report.md");
  writeFileSync(md, `${lines.join("\n")}\n`);
  return md;
}
