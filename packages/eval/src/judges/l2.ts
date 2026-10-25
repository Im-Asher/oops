import { chromium, type Browser } from "playwright";
import type { Failure } from "../taxonomy";

export interface Geometry {
  overflowPx: number;
  clientHeight: number;
  scrollHeight: number;
  text: string;
  images: { src: string; width: number; height: number }[];
}

let browserPromise: Promise<Browser> | null = null;

/** 浏览器实例复用：一批评测共用一个，进程退出前 close。 */
export async function getBrowser(): Promise<Browser> {
  browserPromise ??= (async () => {
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
  })();
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
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
    await page.setContent(html, { waitUntil: "load" });
    return await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return {
        overflowPx: Math.max(
          0,
          doc.scrollHeight - window.innerHeight,
          body.scrollWidth - window.innerWidth,
        ),
        clientHeight: window.innerHeight,
        scrollHeight: doc.scrollHeight,
        text: body.innerText,
        images: Array.from(document.images).map((i) => ({
          src: i.getAttribute("src") ?? "",
          width: i.naturalWidth,
          height: i.naturalHeight,
        })),
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
    failures.push({
      code: "overflow",
      detail: `内容超出画布 ${metrics.overflowPx}px（上限 ${maxOverflowPx}px）`,
    });
  }
  const broken = metrics.images.filter((i) => i.width === 0 || i.height === 0);
  if (broken.length > 0) {
    failures.push({ code: "image_missing", detail: `${broken.length} 个 <img> 未加载` });
  }
  return { pass: failures.length === 0, failures };
}
