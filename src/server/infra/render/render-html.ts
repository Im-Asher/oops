import { chromium, type Browser } from "playwright-core";
import { RENDER_ALLOWED_HOSTS, RENDER_EXECUTABLE_PATH, RENDER_TIMEOUT_MS } from "@/lib/config";

export interface RenderHtmlInput {
  html: string;
  width: number;
  height: number;
  /** 出网白名单 host；缺省用环境配置。 */
  allowedHosts?: readonly string[];
  /** 单次渲染超时 ms；缺省用环境配置。 */
  timeoutMs?: number;
  /** 中断信号：abort 时立即销毁渲染上下文。 */
  signal?: AbortSignal;
}

export interface RenderedPage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** 可注入的渲染实现（handler 测试用 fake 替换）。 */
export type HtmlRenderer = (input: RenderHtmlInput) => Promise<RenderedPage>;

/** 渲染失败分类（html-rendering spec「结构化分类」）。 */
export type RenderErrorKind = "invalid_html" | "timeout" | "unknown";

export class RenderError extends Error {
  constructor(
    readonly kind: RenderErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * HTML 预校验：拒绝脚本载体（script 标签、内联事件属性、javascript: URL）。
 * Agent 生成的海报必须纯静态；这是禁 JS 的主闸门（页面级拦截兜底外链脚本）。
 */
export function assertNoScripts(html: string): void {
  if (/<script[\s>]/i.test(html) || /<\/script\s*>/i.test(html)) {
    throw new RenderError("invalid_html", "HTML 含 script 标签，拒绝渲染");
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    throw new RenderError("invalid_html", "HTML 含内联事件属性，拒绝渲染");
  }
  if (/javascript\s*:/i.test(html)) {
    throw new RenderError("invalid_html", "HTML 含 javascript: URL，拒绝渲染");
  }
}

const SCRIPT_CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src * data: blob:; style-src \'unsafe-inline\' * data:; font-src * data:">';

/** CSP 纵深：html 未自带 CSP 时注入禁脚本策略（不改变正常静态渲染）。 */
function withScriptCsp(html: string): string {
  if (/<meta[^>]+http-equiv=["']?content-security-policy/i.test(html)) return html;
  return html.replace(/<head([^>]*)>/i, `<head$1>${SCRIPT_CSP_META}`);
}

let browserPromise: Promise<Browser> | null = null;

function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(RENDER_EXECUTABLE_PATH ? { executablePath: RENDER_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

/** 浏览器实例惰性启动 + 复用；崩溃/退出后下次调用重建。 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const created = launchBrowser();
    browserPromise = created.then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
    // 启动失败时清缓存，允许重试
    created.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

/**
 * 沙箱渲染 HTML → PNG（html-rendering spec）：
 * 禁 JS（预校验 + 脚本拦截 + CSP 纵深）、出网白名单（其余请求 abort 且不致命）、
 * 单渲染超时（硬 abort）。固定视口截图，浏览器实例进程内复用。
 */
export async function renderHtml(input: RenderHtmlInput): Promise<RenderedPage> {
  const { html, width, height } = input;
  const allowedHosts = input.allowedHosts ?? RENDER_ALLOWED_HOSTS;
  const timeoutMs = input.timeoutMs ?? RENDER_TIMEOUT_MS;
  assertNoScripts(html);

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height } });
  const onAbort = () => {
    void context.close().catch(() => {});
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const page = await context.newPage();
    // 出网白名单：仅 data: 与白名单 host 放行；外链脚本一律 abort（第二道防线）；
    // 单个资源缺失不判定任务失败（渲染继续）。
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.resourceType() === "script") return void route.abort();
      const url = new URL(request.url());
      if (url.protocol === "data:") return void route.continue();
      const allowed = allowedHosts.some(
        (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
      );
      return void (allowed ? route.continue() : route.abort());
    });
    page.setDefaultTimeout(timeoutMs);

    let timer: NodeJS.Timeout | undefined;
    const hardTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RenderError("timeout", `渲染超过 ${timeoutMs}ms 未完成`)),
        timeoutMs,
      );
    });
    const render = (async () => {
      await page.setContent(withScriptCsp(html), { waitUntil: "load" });
      const png = await page.screenshot({ type: "png" });
      return { png: new Uint8Array(png), width, height };
    })();
    // hardTimeout 先触发时 render 可能后败，挂空 catch 防 unhandled rejection
    render.catch(() => {});
    try {
      return await Promise.race([render, hardTimeout]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError("unknown", "渲染失败", err);
  } finally {
    await context.close().catch(() => {});
  }
}
