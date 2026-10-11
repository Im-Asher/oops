/**
 * 文字预设目录（spec design-editor「文字与艺术字体」）：标题/副标题/正文
 * 三档点击即插入。尺寸语义与模版目录一致（800 宽画布基准）；插入时由
 * 页面层做视口中心对齐（centerFragmentAt），字体/内容均为普通元素属性。
 */
import type { TextElement } from "@/lib/design/doc";
import { textElement } from "@/lib/design/elements";
import type { DesignFont } from "@/lib/design/fonts";

export type TextPresetId = "title" | "subtitle" | "body";

export interface TextPreset {
  id: TextPresetId;
  color: string;
  fontSize: number;
  fontWeight: number;
  /** 单行包围盒（800 宽基准）：h ≈ fontSize × lineHeight。 */
  w: number;
  h: number;
  lineHeight: number;
}

export const TEXT_PRESETS: TextPreset[] = [
  { color: "#111827", fontSize: 48, fontWeight: 700, h: 58, id: "title", lineHeight: 1.2, w: 600 },
  { color: "#374151", fontSize: 28, fontWeight: 500, h: 36, id: "subtitle", lineHeight: 1.3, w: 480 },
  { color: "#4b5563", fontSize: 18, fontWeight: 400, h: 27, id: "body", lineHeight: 1.5, w: 360 },
];

export function findTextPreset(id: string): TextPreset | null {
  return TEXT_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * 由预设构造画布文本元素：x/y 占位 (0,0)，由调用方视口中心对齐后插入。
 * content 为词典解析后的样例文案（随 locale 变化）。
 */
export function textPresetElement(preset: TextPreset, content: string): TextElement {
  return textElement({
    align: "center",
    color: preset.color,
    content,
    fontSize: preset.fontSize,
    fontWeight: preset.fontWeight,
    h: preset.h,
    lineHeight: preset.lineHeight,
    w: preset.w,
    x: 0,
    y: 0,
  });
}

/** 艺术字体样张元素：默认字号稍大，字体/字重来自字体目录。 */
export function fontSampleElement(font: DesignFont, content: string): TextElement {
  return textElement({
    content,
    fontFamily: font.family,
    fontSize: 40,
    fontWeight: font.weight,
    h: 48,
    lineHeight: 1.2,
    w: 480,
    x: 0,
    y: 0,
  });
}
