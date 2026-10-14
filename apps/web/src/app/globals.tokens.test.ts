import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 设计 token 契约守卫（docs/DESIGN.md B1 四层分层的落地校验）。
 *
 * 覆盖 Layer 1（品牌色阶）与 Layer 4（形状 / 动效）+ 字体 token；Layer 2 语义层换色
 * 由change `add-landing-page` 的 Step 3 负责，其验证在对应任务里，不在本文件断言。
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "globals.css"), "utf-8");

/** 收集 CSS 里声明的自定义属性名（不含 Tailwind 的 --color-* 别名层）。 */
function declaredTokens(source: string): Set<string> {
  return new Set([...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

const tokens = declaredTokens(css);

describe("globals.css 设计 token 契约", () => {
  it("Layer 1 品牌色阶齐全（violet 6 档 / cyan 5 档 / ink 12 档）", () => {
    const expected = [
      ...[50, 100, 300, 500, 600, 700].map((s) => `--brand-violet-${s}`),
      ...[50, 100, 500, 600, 700].map((s) => `--brand-cyan-${s}`),
      ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950].map((s) => `--brand-ink-${s}`),
    ];
    const missing = expected.filter((t) => !tokens.has(t));
    expect(missing).toEqual([]);
  });

  it("品牌色带 --brand- 前缀，不与 Tailwind 内置色阶撞名", () => {
    // Tailwind v4 自带 --color-violet-500: #8d54ff，与品牌紫 #7d2ae8 不同；
    // 一旦出现无前缀的 --violet-* / --cyan-* / --ink-*，同屏就会出现两个紫。
    const unprefixed = [...tokens].filter((t) => /^--(violet|cyan|ink)-\d+$/.test(t));
    expect(unprefixed).toEqual([]);
  });

  it("品牌紫取 Canva 原色 #7d2ae8", () => {
    expect(css).toMatch(/--brand-violet-500:\s*#7d2ae8\s*;/i);
    expect(css).toMatch(/--brand-cyan-500:\s*#00c4cc\s*;/i);
  });

  it("Layer 3 品牌 token 齐全（渐变 / blob / 投影）", () => {
    const expected = [
      "--brand-gradient",
      "--brand-blob-1",
      "--brand-blob-2",
      "--brand-blob-3",
      "--brand-shadow",
      "--brand-shadow-hover",
    ];
    expect(expected.filter((t) => !tokens.has(t))).toEqual([]);
  });

  it("Layer 4 形状与动效刻度齐全（DESIGN.md B4 / B5 / B6）", () => {
    const expected = [
      "--radius-media",
      "--radius-pill",
      "--shadow-1",
      "--shadow-2",
      "--shadow-pop",
      "--duration-fast",
      "--duration-base",
      "--duration-slow",
      "--ease-standard",
      "--ease-exit",
      "--ease-back",
    ];
    expect(expected.filter((t) => !tokens.has(t))).toEqual([]);
  });

  it("既有圆角派生链未被破坏（sm…4xl 仍由 --radius 派生）", () => {
    expect(css).toMatch(/--radius:\s*0\.625rem\s*;/);
    expect(css).toMatch(/--radius-sm:\s*calc\(var\(--radius\) \* 0\.6\)/);
    expect(css).toMatch(/--radius-4xl:\s*calc\(var\(--radius\) \* 2\.6\)/);
  });

  it("字体 token 齐全且 --font-sans 不再自引用", () => {
    for (const t of ["--font-sans", "--font-display", "--font-editorial", "--font-mono", "--font-heading"]) {
      expect(tokens.has(t)).toBe(true);
    }
    // 自引用会让计算值失效：font-family 落回浏览器初始 serif（DESIGN.md B3.3）
    expect(css).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-geist-sans\)/);
  });
});