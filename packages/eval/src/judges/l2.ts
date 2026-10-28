import { chromium, type Browser } from "playwright";
import type { Failure } from "../taxonomy";

export interface OverflowOffender {
  tag: string;
  /** 元素自身文本前 24 字，便于定位「是哪个块被裁了」。 */
  snippet: string;
  /** 越界像素（纵向取 rect.bottom - 视口高，横向取 rect.right - 视口宽）。 */
  over: number;
}

export interface Geometry {
  /**
   * 真实溢出：只有**承载文本或图片**的元素越界才算。
   * 纯装饰块（出血色块、背景圆）故意伸出画布是常见设计手法，不该判失败——
   * 拿整篇文档的 scrollHeight 当指标会让每张带装饰的海报都假报警。
   */
  overflowPx: number;
  /** 文档整体可滚动高度超出量：含装饰出血，仅作诊断参考，不参与判定。 */
  documentOverflowPx: number;
  clientHeight: number;
  scrollHeight: number;
  text: string;
  images: { src: string; width: number; height: number }[];
  offenders: OverflowOffender[];
}

let browserPromise: Promise<Browser> | null = null;

/** 不可解析的基址：只为把相对 URL 变成绝对 URL，本身永不真正出网（路由全部 abort/fulfill）。 */
export const BASE_URL = "http://eval.invalid/";

/**
 * 浏览器实例复用：一批评测共用一个，进程退出前 close。
 * - 启动失败不能缓存 rejected promise：否则后续每个用例都立刻失败、永不重试。
 * - 已断开的实例也要重建：浏览器崩溃/被外部杀掉后不该连带整轮评测失败。
 */
export async function getBrowser(): Promise<Browser> {
  // 复用仍然活着的实例
  const cached = browserPromise;
  if (cached) {
    const b = await cached.catch(() => null);
    if (b && b.isConnected()) return b;
    if (browserPromise === cached) browserPromise = null;
  }

  const p = launchBrowser();
  browserPromise = p;
  // 启动失败不能留下 rejected promise：否则后续每个用例都立刻失败、永不重试
  p.catch(() => {
    if (browserPromise === p) browserPromise = null;
  });
  return p;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    if (!message.includes("Executable doesn't exist")) throw err;
    console.warn(
      "[eval] 未安装 playwright chromium，回退到系统 Chrome。如需自带浏览器：pnpm --filter @oops/eval exec playwright install chromium",
    );
    return chromium.launch({ headless: true, channel: "chrome" });
  }
}

/** 关闭失败不影响退出码：CLI 的 catch 分支还会调用它，不能被这里再抛一次覆盖 exit 2。 */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    const b = await p;
    await b.close();
  } catch {
    // 浏览器没起来或已退出：无需处理
  }
}

/**
 * 在 Chromium 里量模型产出的 HTML。
 * js 关闭是结构性事实：测量靠 Playwright 的 CDP evaluate，不依赖页面脚本。
 */
export async function measureHtml(
  html: string,
  size: [number, number],
  options: { fileBytes?: Map<string, Uint8Array> } = {},
): Promise<Geometry> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: size[0], height: size[1] },
  });
  try {
    const page = await context.newPage();
    // 拦截出网：/files/* 用调用方给的字节回填，其余一律 abort（与生产白名单一致）
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const bytes = options.fileBytes?.get(url.pathname);
      if (bytes) {
        return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(bytes) });
      }
      if (url.protocol === "data:") return route.continue();
      return route.abort();
    });
    // 注入 base：setContent 的文档落在 about:blank，浏览器不会为 /files/x.png 这类相对 URL 发起请求，
    // page.route 也就匹配不到，<img>.naturalWidth 恒为 0。有了 base 相对路径被解析成可拦截的绝对请求。
    await page.setContent(`<base href="${BASE_URL}">${html}`, { waitUntil: "load" });
    return await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      const offenders: { tag: string; snippet: string; over: number }[] = [];
      for (const el of Array.from(body.querySelectorAll("*"))) {
        const carriesText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
        );
        const isImage = el.tagName === "IMG";
        if (!carriesText && !isImage) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const overY = Math.round(r.bottom - vh);
        const overX = Math.round(r.right - vw);
        const over = Math.max(overY, overX, 0);
        if (over > 0) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            snippet: (el.textContent ?? "").trim().slice(0, 24),
            over,
          });
        }
      }

      return {
        overflowPx: offenders.reduce((m, o) => Math.max(m, o.over), 0),
        documentOverflowPx: Math.max(
          0,
          doc.scrollHeight - vh,
          body.scrollWidth - vw,
        ),
        clientHeight: vh,
        scrollHeight: doc.scrollHeight,
        text: body.innerText,
        images: Array.from(document.images).map((i) => ({
          src: i.getAttribute("src") ?? "",
          width: i.naturalWidth,
          height: i.naturalHeight,
        })),
        offenders: offenders.sort((a, b) => b.over - a.over).slice(0, 5),
      };
    });
  } finally {
    await context.close();
  }
}

export function judgeL2(input: { metrics: Geometry; maxOverflowPx: number }): {
  pass: boolean;
  failures: Failure[];
} {
  const failures: Failure[] = [];
  const { metrics, maxOverflowPx } = input;
  if (metrics.overflowPx > maxOverflowPx) {
    const who = metrics.offenders
      .slice(0, 3)
      .map((o) => `<${o.tag}>${o.snippet ? `「${o.snippet}」` : ""}+${o.over}px`)
      .join("、");
    failures.push({
      code: "overflow",
      detail:
        `文本/图片越界 ${metrics.overflowPx}px（上限 ${maxOverflowPx}px）：${who}` +
        (metrics.documentOverflowPx > metrics.overflowPx
          ? `（另有 ${metrics.documentOverflowPx - metrics.overflowPx}px 为装饰出血，未计入）`
          : ""),
    });
  }
  const broken = metrics.images.filter((i) => i.width === 0 || i.height === 0);
  if (broken.length > 0) {
    failures.push({ code: "image_missing", detail: `${broken.length} 个 <img> 未加载` });
  }
  return { pass: failures.length === 0, failures };
}
