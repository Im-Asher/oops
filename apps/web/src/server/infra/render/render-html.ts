/**
 * 海报渲染对外契约入口：把 Agent 产出的 HTML 编排为 PNG。
 *
 * 本模块只做编排，不做渲染实现：
 *   1. 版式静态校验（不支持的属性直接拒绝，回喂 Agent 改写）
 *   2. 图片引用出网闸门（剥离非 data: 与非白名单 host 的外链）
 *   3. 文件引用内联（/files/xxx → data URI）
 *   4. 无浏览器渲染流水线（HTML → VDOM → SVG → PNG）
 *
 * 对外导出签名（renderHtml / RenderError / RenderErrorKind / HtmlRenderer）保持不变，
 * 消费方（domain/tasks/handlers.ts）零感知。
 *
 * 历史：此模块原先用 Playwright + headless Chromium 截图，并为此叠了三层禁脚本
 * 防护（正则预校验 / CSP 注入 / script 请求拦截）。渲染器不执行 JS 后，
 * 「不执行脚本」从补丁变成结构性事实，三层防护已删除；出网白名单则前移为
 * 第 2 步的渲染前扫描，见 assert-image-urls.ts。
 */
import { getRenderConfig } from "@oops/config";
import { assertImageUrls } from "./assert-image-urls";
import { assertLayoutSupport, describeLayoutViolations } from "./assert-layout-support";
import { inlineFileRefs } from "./inline-files";
import { renderHtmlToPng } from "./satori-pipeline";

export interface RenderHtmlInput {
  html: string;
  width: number;
  height: number;
  /** 出网白名单 host；缺省用环境配置。 */
  allowedHosts?: readonly string[];
  /** 单次渲染超时 ms；缺省用环境配置。 */
  timeoutMs?: number;
  /** 中断信号：abort 时立即中止渲染。 */
  signal?: AbortSignal;
  /** 可注入的渲染实现（测试用慢渲染替身验证超时路径）。 */
  renderer?: (input: {
    html: string;
    width: number;
    height: number;
    signal?: AbortSignal;
  }) => Promise<RenderedPage>;
}

export interface RenderedPage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** 可注入的渲染实现（handler 测试用 fake 替换）。 */
export type HtmlRenderer = (input: RenderHtmlInput) => Promise<RenderedPage>;

/** 渲染失败分类（poster-rendering spec「结构化分类」）。 */
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
 * 渲染日志字段（结构化，不含 HTML 原文与外链地址）。
 * 渲染失败时便于定位：档位、体积、剥离计数，而不把不可信内容写进日志。
 */
export interface RenderLogFields {
  htmlLength: number;
  width: number;
  height: number;
  strippedImages: number;
}

/** 版式非法时的错误消息（回喂给 Agent 的文本）。 */
function invalidLayoutMessage(violations: ReturnType<typeof describeLayoutViolations>): string {
  return violations;
}

/**
 * 渲染 HTML → PNG。
 *
 * 失败分类：
 * - `invalid_html`：版式用了不受支持的属性，或版式转换失败（Agent 应改写 HTML 后重试）
 * - `timeout`：超过 RENDER_TIMEOUT_MS
 * - `unknown`：其它（含基础设施故障：字体缺失、native binding 不可用）
 */
export async function renderHtml(input: RenderHtmlInput): Promise<RenderedPage> {
  const rc = getRenderConfig();
  const allowedHosts = input.allowedHosts ?? rc.allowedHosts;
  const timeoutMs = input.timeoutMs ?? rc.timeoutMs;
  const { html, width, height } = input;

  const logFields: RenderLogFields = {
    htmlLength: html.length,
    width,
    height,
    strippedImages: 0,
  };

  // 1. 版式静态校验：不支持的属性静默降级比报错更危险，前移到渲染前拦下
  const layout = assertLayoutSupport(html);
  if (!layout.ok) {
    throw new RenderError("invalid_html", invalidLayoutMessage(describeLayoutViolations(layout)));
  }

  // 2. 图片出网闸门：必须在内联之前，顺序颠倒会让外链被内联成 data URI 而绕过
  const scan = assertImageUrls(html, allowedHosts);
  logFields.strippedImages = scan.strippedCount;

  // 3. 文件引用内联（/files/xxx → data URI）
  const inlined = await inlineFileRefs(scan.html);

  // 4. 无浏览器渲染。硬超时用 AbortController + Promise.race。
  // 时序说明：渲染函数内部有多个 await，因此「渲染已 settle」与「计时器触发」
  // 之间由调度决定——已 settle 的 promise 在 race 中总是赢过 setTimeout。超时
  // 只能在渲染真的慢于 timeoutMs 时生效，不能靠传 0 强制触发（config 亦禁止
  // 非正值）。超时测试用注入的慢渲染替身，见 render-html.test.ts。
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    // 外部 abort 与内部超时走同一条路径：都归类 timeout。
    // 注意必须让 controller 先 abort 再 reject，否则渲染替身拿不到取消信号。
    const fail = (reason: string) => {
      controller.abort();
      reject(new RenderError("timeout", reason));
    };
    if (input.signal?.aborted) {
      fail(`渲染被中断（已 abort）`);
      return;
    }
    input.signal?.addEventListener("abort", () => fail(`渲染被中断（已 abort）`), { once: true });
    timer = setTimeout(() => fail(`渲染超过 ${timeoutMs}ms 未完成`), timeoutMs);
  });
  const renderer = input.renderer ?? ((opts) => renderHtmlToPng(opts));
  try {
    const out = await Promise.race([
      renderer({ html: inlined, width, height, signal: controller.signal }),
      timeoutPromise,
    ]);
    return out;
  } catch (err) {
    if (err instanceof RenderError) throw err;
    // 基础设施故障（字体缺失、native binding 不可用等）归 unknown：
    // 语义是「环境问题，Agent 改写 HTML 也修不好」，不可误导成 HTML 有问题。
    if (isInfrastructureError(err)) {
      throw new RenderError("unknown", `渲染环境不可用：${errorDetail(err)}`, err);
    }
    // 版式转换失败（渲染器抛的未知 CSS/结构错误）统一归入 invalid_html：
    // 语义是「HTML 有问题，Agent 可改写后重试」，与任务层不可重试的映射一致。
    throw new RenderError("invalid_html", `海报版式无法渲染：${errorDetail(err)}`, err);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

/** 基础设施故障：字体产物缺失、native binding 不可用等环境问题。 */
function isInfrastructureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /字体|native|binding|NODE_MODULE|wasm/i.test(msg);
}

function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

/** 供任务层记录结构化日志（不含 HTML 原文与外链地址）。 */
export function renderLogFields(input: RenderHtmlInput, strippedImages: number): RenderLogFields {
  return {
    htmlLength: input.html.length,
    width: input.width,
    height: input.height,
    strippedImages,
  };
}
