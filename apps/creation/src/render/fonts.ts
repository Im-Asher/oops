/**
 * 子集字体加载：把 assets/fonts/ 下的两个真实字重按需读出并缓存，
 * 供 satori 显式注入（satori 不回退系统字体，缺字重会静默不出字形）。
 *
 * 字体产物由 scripts/build-subset-font.mjs 产出（源字体在 .fontcache/，不入库）。
 * 缺文件时抛错而非降级：降级会让中文标题静默消失，比明确失败更难排查。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 海报排版契约声明的两个字重（satori 不合成加粗，必须两个真实文件）。 */
export type PosterFontWeight = "regular" | "bold";

/** satori 接受的字重字面量（不是任意 number，写错不报错但匹配不到字重）。 */
export type PosterFontWeightNumber = 400 | 700;

const FONT_FILES: Record<PosterFontWeight, string> = {
  regular: "NotoSansSC-Regular.subset.ttf",
  bold: "NotoSansSC-Bold.subset.ttf",
};

const WEIGHT_NUMBER: Record<PosterFontWeight, PosterFontWeightNumber> = {
  regular: 400,
  bold: 700,
};

/**
 * 字体目录按**模块位置**推导（apps/creation/assets/fonts），不依赖启动时 cwd：
 * creation 不做打包（tsx 直跑源码），module URL 稳定；写成 cwd 相对会在从仓库根
 * 启动时静默找不到文件。
 */
const FONT_DIR = fileURLToPath(new URL("../../assets/fonts", import.meta.url));

const cache = new Map<PosterFontWeight, Buffer>();

/**
 * 读出指定字重的子集字体 buffer（模块级缓存，同一进程只读一次盘）。
 * @throws Error 字体产物缺失——调用方必须让渲染失败，不得静默继续。
 */
export function loadPosterFont(weight: PosterFontWeight): Buffer {
  const cached = cache.get(weight);
  if (cached) return cached;
  const file = resolve(FONT_DIR, FONT_FILES[weight]);
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch (err) {
    throw new Error(
      `子集字体缺失：${file}（请先运行 node scripts/build-subset-font.mjs 产出字体）`,
      { cause: err },
    );
  }
  cache.set(weight, data);
  return data;
}

/**
 * 产出 satori 的 fonts 配置。两个条目用同一 family 名，
 * satori 按 CSS font-weight 匹配到对应文件。
 */
export function posterSatoriFonts(): {
  name: string;
  data: Buffer;
  weight: PosterFontWeightNumber;
  style: "normal";
}[] {
  return (Object.keys(FONT_FILES) as PosterFontWeight[]).map((weight) => ({
    name: "Noto Sans SC",
    data: loadPosterFont(weight),
    weight: WEIGHT_NUMBER[weight],
    style: "normal" as const,
  }));
}

/** 测试用：清空字体缓存。 */
export function resetPosterFontCache(): void {
  cache.clear();
}
