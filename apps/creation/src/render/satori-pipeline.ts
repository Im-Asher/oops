/**
 * 无浏览器渲染流水线：HTML → VDOM → SVG → PNG。
 *
 * 安全、文件内联、任务编排都在上层（render-html.ts）完成，本模块只管渲染本身。
 *
 * ⚠️ 两项配置不可改动，均有实测依据（否则不报错但静默变差）：
 * 1. `embedFont: true`（默认）：关掉后 SVG 改用 <text font-family> 描述文字，
 *    而 resvg 又因第 2 项不加载系统字体，文字会整体丢失（字形数据量实测
 *    19728 → 171）。SVG 稍大（21KB vs 5KB）可忽略。
 * 2. `font: { loadSystemFonts: false }`：resvg 默认每次渲染都扫描运行环境预装
 *    字体，而 SVG 已内嵌字体子集根本不需要。关掉后单次 328ms → 20ms，
 *    端到端约 900ms → 23ms。删掉这一行渲染慢 16 倍且无任何报错。
 */
import satori from "satori";
import { html as htmlToVdom } from "satori-html";
import { Resvg } from "@resvg/resvg-js";
import { posterSatoriFonts, type PosterFontWeightNumber } from "./fonts";

/** 可注入的 satori 字体条目（测试可替身）。 */
export interface SatoriFontEntry {
  name: string;
  data: Buffer;
  weight: PosterFontWeightNumber;
  style: "normal";
}

export interface RenderPngInput {
  html: string;
  width: number;
  height: number;
  /** 可注入字体（测试用）；缺省用内置子集字体。 */
  fonts?: SatoriFontEntry[];
  /** 中断信号：abort 时取消渲染（资源加载中止）。 */
  signal?: AbortSignal;
}

export interface RenderedPng {
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * HTML → PNG。不感知安全与存储，失败抛错由上层归类。
 * @throws Error 版式转换失败（不受支持的 CSS 等）
 */
export async function renderHtmlToPng(input: RenderPngInput): Promise<RenderedPng> {
  const svg = await renderHtmlToSvg(input);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: input.width },
    font: { loadSystemFonts: false },
  });
  const png = resvg.render().asPng();
  return { png: new Uint8Array(png), width: input.width, height: input.height };
}

/**
 * HTML → SVG。独立导出是为了让测试能在**字形层面**断言覆盖：
 * PNG 字节数无法区分「笔画极少的字」与「缺字形」（实测「上」有字形时仅比空白
 * 画布大 2%，压缩后几乎等大），而 SVG 里的字形 path 数据量是精确信号——
 * 有字形则 >0，缺字形则整个文字节点不产生 path。
 */
export async function renderHtmlToSvg(input: RenderPngInput): Promise<string> {
  const { html: htmlString, width, height } = input;
  const fonts = input.fonts ?? posterSatoriFonts();

  // satori 不接受 HTML 字符串，只接受类 React element 的 VDOM，故必须经 satori-html 转换。
  // 类型断言：satori-html 的 VNode 与 satori 的 ReactNode 声明不完全对齐，运行时同构。
  const markup = htmlToVdom(htmlString) as Parameters<typeof satori>[0];
  return satori(markup, { width, height, fonts, embedFont: true });
}
