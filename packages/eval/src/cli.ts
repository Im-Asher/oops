#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./case";
import { createClient } from "./http";
import { createVlm } from "./vlm";
import { countPassed, isBlocking, writeReport, type CaseResult, type Report } from "./report";
import { compareToBaseline, parseBaseline } from "./baseline";
import { parseRepeat } from "./args";
import { repeatCase } from "./repeat-run";
import { closeBrowser } from "./judges/l2";

const PKG = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const tagArg = argv.find((a) => a.startsWith("--tag="))?.split("=")[1];

async function main(): Promise<number> {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
  const username = process.env.EVAL_USERNAME ?? "eval";
  const password = process.env.EVAL_PASSWORD ?? "eval-password-123";
  const vlmBaseUrl =
    process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const apiKey = process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY ?? "";
  if (!apiKey) throw new Error("缺 QWEN_API_KEY / DASHSCOPE_API_KEY");

  const client = createClient({ baseUrl });
  await client.login(username, password);

  let cases = loadCases(join(PKG, "cases"));
  if (flags.has("--smoke")) cases = cases.slice(0, 6);
  if (tagArg) cases = cases.filter((c) => c.tags.includes(tagArg));
  if (cases.length === 0) throw new Error("没有匹配的 case");

  const vlm = createVlm({
    baseUrl: vlmBaseUrl,
    apiKey,
    model: process.env.EVAL_VLM_MODEL ?? "qwen3.7-plus",
  });

  // 本轮产物目录：报告写在根上，每 case 每轮各开 `<id>-r<i>/` 子目录放 HTML 与几何快照
  // （诊断溢出到底卡在哪；重复跑时不区分子目录会互相覆盖）
  const runDir = join(PKG, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  const repeat = parseRepeat(argv);

  const results: CaseResult[] = [];
  for (const c of cases) {
    results.push(
      await repeatCase(
        c,
        {
          client,
          vlm,
          fixturesDir: join(PKG, "fixtures"),
          l4Threshold: l4Threshold(),
        },
        { runDir, n: repeat },
      ),
    );
  }

  const report: Report = {
    runAt: new Date().toISOString(),
    total: results.length,
    passed: countPassed(results),
    results,
    ...(repeat > 1 ? { repeat } : {}),
  };
  const md = writeReport(runDir, report);
  console.log(`\n报告：${md}`);

  const baselinePath = join(PKG, "baseline.json");
  if (flags.has("--update-baseline")) {
    writeFileSync(baselinePath, JSON.stringify({ results }, null, 2));
    console.log(`基线已更新：${baselinePath}`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.log("无基线文件，本次不阻断。跑通后用 --update-baseline 记录基线。");
    // 无基线时唯一能判的就是本轮自身的阻断性失败
    return results.some(isBlocking) ? 1 : 0;
  }

  let cmp: ReturnType<typeof compareToBaseline>;
  try {
    cmp = compareToBaseline({
      baseline: parseBaseline(readFileSync(baselinePath, "utf8")),
      current: report,
    });
  } catch (err) {
    console.error(
      `oops-eval: 基线不可用，未做回归判定（${(err as Error).message}）。修好 ${baselinePath} 或用 --update-baseline 重建。`,
    );
    return 2;
  }
  for (const r of cmp.regressions) console.log(`回归：${r.id} → ${r.code}`);
  for (const r of cmp.fixed) console.log(`修复：${r.id} → ${r.code}`);
  return cmp.blocking ? 1 : 0;
}

/** 空串/非数字不能让阈值变成 0，否则 L4 会静默失效。 */
function l4Threshold(): number {
  const raw = process.env.EVAL_L4_THRESHOLD;
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) ? n : 3;
}

main()
  .then(async (code) => {
    await closeBrowser();
    process.exit(code);
  })
  .catch(async (err) => {
    // closeBrowser 自身不会抛（内部已吞掉关闭错误），这里不会被覆盖退出码
    await closeBrowser();
    console.error(err instanceof Error ? `oops-eval: ${err.message}` : err);
    process.exit(2);
  });
