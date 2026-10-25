#!/usr/bin/env tsx
/**
 * 评测前置体检：把「跑起来才发现缺什么」提前到第 1 秒。
 *
 * 四项检查逐行 ✔ / ✘（✘ 附可直接照做的修复提示），全通过 exit 0，否则 exit 1。
 * 体检只读不写：不建号、不发积分、不连库（DATABASE_URL 只查变量存在性）。
 */
import { existsSync } from "node:fs";

const DEFAULT_BASE_URL = "http://localhost:3000";

interface CheckResult {
  ok: boolean;
  /** 单行结论 */
  detail: string;
  /** 失败时的修复提示 */
  fix?: string;
}

function pass(detail: string): CheckResult {
  return { ok: true, detail };
}

function fail(detail: string, fix: string): CheckResult {
  return { ok: false, detail, fix };
}

/** 脚本类入口手动加载仓库根 env（与 drizzle.config / seed 同约定）。 */
async function loadEnv(): Promise<void> {
  const { loadAppEnv } = await import("@oops/config/load-env");
  loadAppEnv(new URL("../../..", import.meta.url).pathname);
}

// —— 1. VLM API key ——
function checkApiKey(): CheckResult {
  const qwen = process.env.QWEN_API_KEY?.trim();
  const dashscope = process.env.DASHSCOPE_API_KEY?.trim();
  if (qwen) return pass("QWEN_API_KEY 已配置");
  if (dashscope) return pass("DASHSCOPE_API_KEY 已配置（回退）");
  return fail(
    "缺 QWEN_API_KEY / DASHSCOPE_API_KEY（L3/L4 视觉判分需要）",
    "在仓库根 .env.local 里加 QWEN_API_KEY=<key>（或 DASHSCOPE_API_KEY=<key>）。",
  );
}

// —— 2. web 服务可达 ——
async function checkWeb(baseUrl: string): Promise<CheckResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/agents`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    return fail(
      `连不上 ${url}：${message}`,
      `先起 web：pnpm dev（并确认端口与 EVAL_BASE_URL=${baseUrl} 一致）。`,
    );
  }
  // /api/agents 走 requireUser：未登录拿 401 恰恰证明路由活着
  if (res.status === 401) {
    return pass(`GET ${url} → 401（未登录，路由正常）`);
  }
  if (res.ok) {
    return pass(`GET ${url} → ${res.status}`);
  }
  return fail(
    `GET ${url} → ${res.status}`,
    `${baseUrl} 上有服务但不是 oops web（常见：端口被别的应用占用，或 web 挂了），` +
      `确认 pnpm dev 的端口与 EVAL_BASE_URL 一致、或先 pnpm db:migrate。`,
  );
}

// —— 3. Playwright 浏览器 ——
/**
 * 与 playwright 的 channel:"chrome" 解析保持一致：稳定版 Chrome 的安装位置
 * 按平台固定，playwright-core 内置表里就在这些路径（macOS 上
 * "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"）。
 * 这里的判定必须与 src/judges/l2.ts 的 getBrowser() 回退策略同构：
 * 自带 chromium 缺失时它会改用系统 Chrome，故「自带缺失 + 系统 Chrome 在」= 可用。
 */
function systemChromePath(): string | null {
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    const candidates = [
      process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env["PROGRAMFILES(X86)"] &&
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
  }
  // linux：channel:"chrome" 走 PATH 查找。这里只探常见安装点，找不到就按「不可用」报，
  // 提示用户装自带 chromium（最稳，免得依赖发行版路径差异）。
  const linuxCandidates = [
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  return linuxCandidates.find((p) => existsSync(p)) ?? null;
}

async function checkBrowser(): Promise<CheckResult> {
  const installFix =
    "pnpm --filter @oops/eval exec playwright install chromium（或用系统 Chrome：装 Google Chrome 后重读本项）。";
  let bundledPath: string;
  try {
    const { chromium } = await import("playwright");
    bundledPath = chromium.executablePath();
  } catch (err) {
    return fail(`无法加载 playwright：${(err as Error)?.message ?? String(err)}`, installFix);
  }

  if (existsSync(bundledPath)) {
    return pass(`playwright 自带 chromium 就绪（${bundledPath}）`);
  }

  const systemChrome = systemChromePath();
  if (systemChrome) {
    return pass(`自带 chromium 缺失，将回退系统 Chrome（${systemChrome}）`);
  }
  return fail(
    `自带 chromium 不存在（${bundledPath}），且未找到系统 Chrome → L2 版式测量不可用`,
    installFix,
  );
}

// —— 4. DATABASE_URL ——
function checkDatabaseUrl(): CheckResult {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    return fail(
      "缺 DATABASE_URL",
      "在仓库根 .env.local 里加 DATABASE_URL=postgresql://user:pass@localhost:5432/oops。",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(value)) {
    return fail(
      "DATABASE_URL 不是 postgresql 连接串（本项只校验格式，未真连）",
      "改成 postgresql://... 形式。",
    );
  }
  return pass("DATABASE_URL 已配置（未真连）");
}

async function main(): Promise<number> {
  const baseUrl = process.env.EVAL_BASE_URL ?? DEFAULT_BASE_URL;
  console.log(`oops eval 体检（EVAL_BASE_URL=${baseUrl}）\n`);

  const results: { name: string; result: CheckResult }[] = [
    { name: "VLM API key", result: checkApiKey() },
    { name: "web 服务", result: await checkWeb(baseUrl) },
    { name: "浏览器", result: await checkBrowser() },
    { name: "数据库连接串", result: checkDatabaseUrl() },
  ];

  let failed = 0;
  for (const { name, result } of results) {
    if (result.ok) {
      console.log(`✔ ${name}：${result.detail}`);
    } else {
      failed++;
      console.log(`✘ ${name}：${result.detail}`);
      if (result.fix) console.log(`    修复：${result.fix}`);
    }
  }

  console.log();
  if (failed === 0) {
    console.log("全部通过，可以跑 pnpm eval。");
    return 0;
  }
  console.log(`${failed} 项未通过，按上面的修复提示处理后重跑 pnpm eval:doctor。`);
  return 1;
}

try {
  await loadEnv();
  process.exitCode = await main();
} catch (err) {
  console.error(`✘ doctor 自身出错：${(err as Error)?.stack ?? String(err)}`);
  process.exitCode = 1;
}
