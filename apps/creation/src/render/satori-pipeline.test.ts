import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderHtmlToPng, renderHtmlToSvg } from "./satori-pipeline";
import { loadPosterFont, posterSatoriFonts, resetPosterFontCache } from "./fonts";

/**
 * 渲染流水线单测：定宽定高、中文字形、关键配置的回归锁定。
 * 依赖 assets/fonts/ 子集字体产物（缺失时字体模块会明确抛错）。
 */

const FONT_DIR = resolve(process.cwd(), "assets", "fonts");
const hasFonts = (() => {
  try {
    readFileSync(resolve(FONT_DIR, "NotoSansSC-Regular.subset.ttf"));
    readFileSync(resolve(FONT_DIR, "NotoSansSC-Bold.subset.ttf"));
    return true;
  } catch {
    return false;
  }
})();

/**
 * 两个字重是否**互不相同**：Bold 源字体未提供时会有人用 cp 复制 Regular 顶上，
 * 那种情况下粗体会静默退回常规字重——这正是本用例要拦住的回归。
 */
const hasDistinctWeights = (() => {
  if (!hasFonts) return false;
  try {
    const r = readFileSync(resolve(FONT_DIR, "NotoSansSC-Regular.subset.ttf"));
    const b = readFileSync(resolve(FONT_DIR, "NotoSansSC-Bold.subset.ttf"));
    return !r.equals(b);
  } catch {
    return false;
  }
})();

const describeWithFonts = hasFonts ? describe : describe.skip;

describeWithFonts("renderHtmlToPng", () => {
  it("产出定宽定高的 PNG（魔数 + 尺寸）", async () => {    const out = await renderHtmlToPng({
      html: '<div style="width:750px;height:1000px;background:#fff;display:flex"><div style="font-size:80px">测试</div></div>',
      width: 750,
      height: 1000,
    });
    expect(out.width).toBe(750);
    expect(out.height).toBe(1000);
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("中文字形真实渲染（非空白）", async () => {
    const out = await renderHtmlToPng({
      html: '<div style="width:750px;height:400px;background:#fff;display:flex;align-items:center;justify-content:center"><div style="font-size:120px;color:#000">双十一</div></div>',
      width: 750,
      height: 400,
    });
    // 空白画布实测约 2KB（白底 PNG 的压缩基线），含 120px 四个汉字实测约 6.5KB。
    // 用「显著大于空白」作为有字形的判据，阈值取空白基线的 2 倍。
    const blank = await renderHtmlToPng({
      html: '<div style="width:750px;height:400px;background:#fff"></div>',
      width: 750,
      height: 400,
    });
    expect(out.png.byteLength).toBeGreaterThan(blank.png.byteLength * 2);
  });

  it("两个真实字重均被注入且互不相同（Bold 不退回常规）", async () => {
    const fonts = posterSatoriFonts();
    expect(fonts).toHaveLength(2);
    expect(fonts.map((f) => f.weight).sort()).toEqual([400, 700]);
    expect(fonts[0].data.byteLength).toBeGreaterThan(1000);
    expect(fonts[1].data.byteLength).toBeGreaterThan(1000);
    // 两个字重必须是不同文件：若误用同一源，Bold 会静默退回常规字重。
    // 该断言仅在两个字重确实不同时求值——占位（cp 复制）状态下跳过，
    // 由 hasDistinctWeights 单独锁定「不得用占位糊弄」。
    if (hasDistinctWeights) {
      expect(fonts[0].data.equals(fonts[1].data)).toBe(false);
    }
  });

  it("两个字重在渲染层面确实生效（Bold 不是被注入后忽略）", async () => {
    // 只比文件字节不够：satori 若匹配不到 weight:700 的条目会静默退回常规，
    // 文件不同但渲染结果相同。必须落到像素层面验证。
    const mk = (weight: number | null) =>
      `<div style="width:600px;height:200px;background:#fff;display:flex;align-items:center;justify-content:center"><div style="font-size:90px;${weight === null ? "" : `font-weight:${weight};`}color:#000">重磅标题</div></div>`;
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
    const r400 = await renderHtmlToPng({ html: mk(400), width: 600, height: 200 });
    const r700 = await renderHtmlToPng({ html: mk(700), width: 600, height: 200 });
    const rNone = await renderHtmlToPng({ html: mk(null), width: 600, height: 200 });

    expect(same(r400.png, r700.png)).toBe(false); // Bold 与 Regular 渲染结果不同
    expect(same(r700.png, rNone.png)).toBe(false); // Bold 也不是「什么都不匹配」的退化结果
    // 不声明 font-weight 时应落到 Regular（satori 默认字重 400）
    expect(same(r400.png, rNone.png)).toBe(true);
  });

  it("电商符号 ¥ 与数字有字形", async () => {
    const out = await renderHtmlToPng({
      html: '<div style="width:750px;height:200px;background:#fff;display:flex;align-items:center"><div style="font-size:80px">¥299 × 5</div></div>',
      width: 750,
      height: 200,
    });
    expect(out.png.byteLength).toBeGreaterThan(1000);
  });

  it("常用电商文案逐字有字形（字符集覆盖回归）", async () => {
    // 字符集是静默决定成败的因素：收窄时缺字不报错、只在成品上留空白。
    // 必须在 SVG 的字形 path 层面断言——PNG 字节数区分不了「笔画极少的字」
    // 与「缺字形」（实测「上」有字形时仅比空白画布大 2%）。
    const mk = (text: string) =>
      `<div style="width:750px;height:300px;background:#fff;display:flex;align-items:center;justify-content:center"><div style="font-size:80px;color:#000">${text}</div></div>`;
    const glyphDataLength = async (text: string) => {
      const svg = await renderHtmlToSvg({ html: mk(text), width: 750, height: 300 });
      return (svg.match(/<path[^>]*\sd="([^"]*)"/g) ?? []).reduce(
        (sum, tag) => sum + tag.length,
        0,
      );
    };

    const words = [
      "标题", "商品", "图片", "价格", "品质", "新品上市",
      "爆款热卖", "限时秒杀", "包邮", "顺丰", "预售",
    ];
    const chars = [...new Set([...words.join(""), ..."0123456789¥", ..."。，！？"])];
    for (const ch of chars) {
      expect(await glyphDataLength(ch), `「${ch}」(U+${ch.codePointAt(0)!.toString(16)}) 疑似缺字形`).toBeGreaterThan(100);
    }
  });

  it("字体未覆盖的字符留空且不抛错（缺字形是静默的）", async () => {
    const mk = (text: string) =>
      `<div style="width:750px;height:300px;background:#fff;display:flex;align-items:center;justify-content:center"><div style="font-size:100px;color:#000">${text}</div></div>`;
    // 子集只覆盖 0x4E00-0x5A00；鼱(U+9F31)/龘(U+9F98) 在范围外。
    const covered = await renderHtmlToPng({ html: mk("限时秒杀"), width: 750, height: 300 });
    const missing = await renderHtmlToPng({ html: mk("鼱龘"), width: 750, height: 300 });
    const blank = await renderHtmlToPng({ html: mk(""), width: 750, height: 300 });

    // 不抛错、仍是合法 PNG
    expect(Array.from(missing.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    // 缺字形 = 什么都不画：与空白画布几乎等大（实测 1583 vs 1583），
    // 而有字形是其 7 倍以上（11894）。若将来改成画方框替代，此断言会失败。
    expect(missing.png.byteLength).toBe(blank.png.byteLength);
    expect(covered.png.byteLength).toBeGreaterThan(blank.png.byteLength * 3);
  });

  it("可注入字体（测试替身不需要读盘）", async () => {
    const font = {
      name: "Noto Sans SC",
      data: loadPosterFont("regular"),
      weight: 400 as const,
      style: "normal" as const,
    };
    const out = await renderHtmlToPng({
      html: '<div style="width:200px;height:100px;background:#fff;display:flex"><div style="font-size:20px">测试</div></div>',
      width: 200,
      height: 100,
      fonts: [font],
    });
    expect(out.png.byteLength).toBeGreaterThan(100);
  });
});

describe("两个字重不得用同一文件占位", () => {
  it("Bold 与 Regular 必须是不同文件（真实 Bold 源提供后必须成立）", () => {
    if (!hasFonts) return;
    const r = readFileSync(resolve(FONT_DIR, "NotoSansSC-Regular.subset.ttf"));
    const b = readFileSync(resolve(FONT_DIR, "NotoSansSC-Bold.subset.ttf"));
    // 用 cp 复制 Regular 顶替 Bold 时，粗体会静默退回常规字重，且无任何报错。
    expect(r.equals(b)).toBe(false);
  });
});


describe("fonts", () => {
  it("惰性缓存：重复加载返回同一 buffer", () => {
    if (!hasFonts) return;
    resetPosterFontCache();
    const a = loadPosterFont("regular");
    const b = loadPosterFont("regular");
    expect(a).toBe(b);
    resetPosterFontCache();
  });
});

describe("性能回归锁定（防 loadSystemFonts 被误删）", () => {
  it("单次渲染远低于系统字体扫描的开销量级（实测 20ms vs 328ms）", async () => {
    if (!hasFonts) return;
    const html =
      '<div style="width:750px;height:1334px;background:#fff;display:flex;flex-direction:column;padding:40px"><div style="font-size:80px">标题文字</div><div style="font-size:40px">副标题</div></div>';
    // 预热（native binding 首次加载）
    await renderHtmlToPng({ html, width: 750, height: 1334 });
    const t0 = performance.now();
    await renderHtmlToPng({ html, width: 750, height: 1334 });
    const elapsed = performance.now() - t0;
    // 关掉系统字体扫描实测约 20ms；阈值放宽到 300ms 以容忍 CI 抖动，
    // 但仍远低于开着时的 328ms+，删掉配置会立即越界。
    expect(elapsed).toBeLessThan(300);
  });
});
