import { join } from "node:path";
import type { EvalCase } from "./case";
import { executeCase, type ExecCtx } from "./execute";
import { mergeLabel, runLabel } from "./args";
import { mergeRuns } from "./repeat";
import type { CaseResult } from "./report";

export interface RepeatOpts {
  /** 本轮 runDir，每 case 每轮在其下开 `${id}-r{i}` 子目录放产物。 */
  runDir: string;
  /** 轮次，至少 1（调用方保证）。 */
  n: number;
  /** 进度输出，默认写 stdout。 */
  write?: (chunk: string) => void;
}

/**
 * 串行跑同一个 case N 次并按多数票合并。单次抛错记成一条失败参与合并：
 * 一次网络抖动不该让整例直接归零，也不该被静默吞掉。
 */
export async function repeatCase(
  c: EvalCase,
  ctx: ExecCtx,
  opts: RepeatOpts,
): Promise<CaseResult> {
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk));
  const runs: CaseResult[] = [];
  for (let i = 0; i < opts.n; i++) {
    // 每轮一个独立产物目录，否则 N 轮会互相覆盖 HTML 快照，诊断时只剩最后一轮
    const artifactDir = join(opts.runDir, `${c.id}-r${i + 1}`);
    write(opts.n > 1 ? `▶ ${c.id} (${i + 1}/${opts.n}) ... ` : `▶ ${c.id} ... `);
    try {
      const r = await executeCase(c, { ...ctx, artifactDir });
      runs.push(r);
      write(`${runLabel(r)}\n`);
    } catch (err) {
      const message = (err as Error).message;
      runs.push({
        id: c.id,
        agent: c.agent,
        durationMs: 0,
        imageUrl: null,
        failures: [{ code: "render_error", detail: message }],
        l4: null,
        toolCalls: [],
        rawText: "",
      });
      write(`ERROR ${message}\n`);
    }
  }
  const merged = mergeRuns(runs);
  // 单跑时保持原有输出：多一行摘要只是噪声
  if (opts.n > 1) write(`  → ${c.id}: ${mergeLabel(merged)}\n`);
  return merged;
}
