import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 设计 token 契约守卫（docs/DESIGN.md B1 四层分层的落地校验）。
 *
 * 覆盖 Layer 1（品牌色阶）、Layer 2（语义层关键映射与 .landing-root 同步）、
 * Layer 4（形状 / 动效）+ 字体 token。
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
      "--brand-blue-500",
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

  it("每个品牌色阶档位都有 @theme 别名（缺一个，Step 2 的工具类就会静默失效）", () => {
    const ramps = [...css.matchAll(/--brand-(violet|cyan|blue|ink)-(\d+):/g)].map(
      (m) => `--color-brand-${m[1]}-${m[2]}: var(--brand-${m[1]}-${m[2]})`,
    );
    const missing = [...new Set(ramps)].filter((alias) => !css.includes(alias));
    expect(missing).toEqual([]);
  });

  it("Step 2 依赖的四个 @utility 已注册（删掉任何一个，落地页以 unknown utility 报错）", () => {
    for (const name of ["rounded-media", "rounded-pill", "bg-brand-gradient", "text-brand-gradient"]) {
      expect(css).toMatch(new RegExp(`@utility ${name}\\s*\\{`));
    }
  });

  it("品牌渐变只经 token 组合，无裸 hex（改品牌色时渐变不会静默过期）", () => {
    const gradient = css.match(/--brand-gradient:\s*([^;]+);/)?.[1] ?? "";
    expect(gradient).toMatch(/linear-gradient/);
    expect(gradient).toContain("var(--brand-violet-500)");
    expect(gradient).toContain("var(--brand-blue-500)");
    expect(gradient).toContain("var(--brand-cyan-700)");
    expect(gradient).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  /** 提取某个选择器块内的全部自定义属性声明。 */
  function blockVars(selector: string): Map<string, string> {
    const block = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
    return new Map([...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)].map((m) => [m[1], m[2].trim()]));
  }

  it("Step 3 语义层关键映射（B2.7）：primary 走品牌紫，ring 走青色档", () => {
    const root = blockVars(":root");
    const dark = blockVars("\\.dark");
    for (const vars of [root, dark]) {
      expect(vars.get("--primary")).toBe("var(--brand-violet-500)");
      expect(vars.get("--primary-foreground")).toBe("#ffffff");
    }
    expect(root.get("--ring")).toBe("var(--brand-cyan-600)");
    expect(dark.get("--ring")).toBe("var(--brand-cyan-500)");
  });

  it(".landing-root 与 :root 语义层一字不差（D2 手工同步规则，漂移即红）", () => {
    const root = blockVars(":root");
    const landing = blockVars("\\.landing-root");
    expect(landing.size).toBeGreaterThan(0);
    const drift = [...landing].filter(([k, v]) => root.get(k) !== v).map(([k]) => k);
    expect(drift).toEqual([]);
  });

  it("侧栏宽度 token 走 @theme 间距命名空间产出 w-sidebar / w-sidebar-rail（DESIGN.md B7.2.1）", () => {
    expect(css).toMatch(/--spacing-sidebar:\s*232px\s*;/);
    expect(css).toMatch(/--spacing-sidebar-rail:\s*64px\s*;/);
    // 落进 :root 会让上一条的 .landing-root 镜像守卫变红，故在此显式钉死
    const root = blockVars(":root");
    expect(root.has("--spacing-sidebar")).toBe(false);
    expect(root.has("--spacing-sidebar-rail")).toBe(false);
    // 必须落在 @theme inline 内，否则不产出工具类
    const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(theme).toContain("--spacing-sidebar:");
    expect(theme).toContain("--spacing-sidebar-rail:");
  });

  it("B2.6/B2.1：canvas 与 design 组件不再使用 Tailwind 内置紫，点阵走 --stage-dot", () => {
    const chromeFiles = [
      "../components/canvas/canvas-stage.tsx",
      "../components/design/design-canvas.tsx",
      "../components/design/design-handles.tsx",
      "../components/design/design-element-view.tsx",
      "../components/design/design-materials-panel.tsx",
      "../components/design/design-text-panel.tsx",
      "../components/design/design-template-panel.tsx",
      "../components/design/design-right-panel.tsx",
    ];
    for (const rel of chromeFiles) {
      const src = readFileSync(resolve(here, rel), "utf-8");
      // chrome 允许品牌紫，但必须走 --brand- token（B2.1 命名规则）；Tailwind 内置紫撞名禁用
      expect(src).not.toMatch(/(?:bg|border|ring|outline|text|from|to|via)-violet-\d/);
    }
    expect(tokens.has("--stage-dot")).toBe(true);
    const stage = readFileSync(resolve(here, chromeFiles[0]!), "utf-8");
    expect(stage).toContain("var(--stage-dot)");
    // 点阵不允许硬编码色值（品牌色渗入舞台的隐蔽通道）
    expect(stage).not.toMatch(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+/);
  });
});