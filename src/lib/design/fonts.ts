/**
 * 设计编辑器字体目录：艺术字体仅为文本元素的 fontFamily 属性，
 * 与模版/既有元素零耦合（spec「字体不影响已有元素」）。
 * 字体文件：得意黑 public/fonts 单文件；霞鹜文楷 layout 引入的 npm 切片包（按需加载）。
 */

export interface DesignFont {
  id: string;
  /** CSS font-family 值，须与 @font-face 声明一致。 */
  family: string;
  /** 预览与元素渲染用字重。 */
  weight: number;
}

export const DEFAULT_FONT_FAMILY =
  "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";

export const DESIGN_FONTS: DesignFont[] = [
  { id: "smiley-sans", family: "'Smiley Sans'", weight: 400 },
  { id: "lxgw-wenkai", family: "'LXGW WenKai'", weight: 400 },
];

export function findFont(id: string): DesignFont | null {
  return DESIGN_FONTS.find((font) => font.id === id) ?? null;
}

/**
 * 插入字体文本前预热字重，保证画布立即以正确字体渲染。
 * 字体未就绪/环境不支持时静默降级（font-display: swap 兜底）。
 */
export async function ensureFontLoaded(font: DesignFont): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts) return false;
  try {
    await document.fonts.load(`${font.weight} 24px ${font.family}`);
    return true;
  } catch {
    return false;
  }
}
