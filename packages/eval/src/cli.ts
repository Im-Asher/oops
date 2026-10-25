#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./case";
import { createClient } from "./http";
import { createVlm } from "./vlm";
import { executeCase } from "./execute";
import { writeReport, type CaseResult, type Report } from "./report";
import { compareToBaseline } from "./baseline";
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

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.id} ... `);
    try {
      const r = await executeCase(c, {
        client,
        vlm,
        fixturesDir: join(PKG, "fixtures"),
        l4Threshold: Number(process.env.EVAL_L4_THRESHOLD ?? 3),
      });
      results.push(r);
      process.stdout.write(
        r.failures.length === 0 ? "PASS\n" : `FAIL ${r.failures.map((f) => f.code).join(",")}\n`,
      );
    } catch (err) {
      const message = (err as Error).message;
      results.push({
        id: c.id,
        agent: c.agent,
        durationMs: 0,
        imageUrl: null,
        failures: [{ code: "render_error", detail: message }],
        l4: null,
        toolCalls: [],
        rawText: "",
      });
      process.stdout.write(`ERROR ${message}\n`);
    }
  }

  const report: Report = {
    runAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    results,
  };
  const md = writeReport(join(PKG, "runs", report.runAt.replace(/[:.]/g, "-")), report);
  console.log(`\n报告：${md}`);

  const baselinePath = join(PKG, "baseline.json");
  if (flags.has("--update-baseline")) {
    writeFileSync(baselinePath, JSON.stringify({ results }, null, 2));
    console.log(`基线已更新：${baselinePath}`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.log("无基线文件，本次不阻断。跑通后用 --update-baseline 记录基线。");
    return 0;
  }

  const cmp = compareToBaseline({
    baseline: JSON.parse(readFileSync(baselinePath, "utf8")),
    current: report,
  });
  for (const r of cmp.regressions) console.log(`回归：${r.id} → ${r.code}`);
  for (const r of cmp.fixed) console.log(`修复：${r.id} → ${r.code}`);
  return cmp.blocking ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeBrowser();
    process.exit(code);
  })
  .catch(async (err) => {
    await closeBrowser();
    console.error(err instanceof Error ? `oops-eval: ${err.message}` : err);
    process.exit(2);
  });
