import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
}

export interface Report {
  runAt: string;
  total: number;
  passed: number;
  results: CaseResult[];
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
    `通过 ${report.passed}/${report.total}`,
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
      const status = r.failures.length === 0 ? "PASS" : r.failures.map((f) => f.code).join(", ");
      return `| ${r.id} | ${status} | ${r.l4?.score ?? "-"} | ${r.durationMs}ms | ${r.imageUrl ?? "-"} |`;
    }),
  ];
  const md = join(dir, "report.md");
  writeFileSync(md, `${lines.join("\n")}\n`);
  return md;
}
