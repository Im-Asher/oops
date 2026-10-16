import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_FAMILY, DESIGN_FONTS } from "@/lib/design/fonts";
import {
  TEXT_PRESETS,
  findTextPreset,
  fontSampleElement,
  textPresetElement,
} from "@/lib/design/text-presets";

describe("文字预设目录", () => {
  it("包含标题/副标题/正文三档，数值合法且 h 与字号行高匹配", () => {
    expect(TEXT_PRESETS.map((p) => p.id)).toEqual(["title", "subtitle", "body"]);
    for (const preset of TEXT_PRESETS) {
      expect(preset.fontSize).toBeGreaterThan(0);
      expect(preset.w).toBeGreaterThan(0);
      expect(preset.h).toBeGreaterThanOrEqual(preset.fontSize * preset.lineHeight - 1);
      expect(preset.h).toBeLessThanOrEqual(preset.fontSize * preset.lineHeight + 1);
      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("findTextPreset 命中与未知的回落", () => {
    expect(findTextPreset("title")?.fontSize).toBe(48);
    expect(findTextPreset("nope")).toBeNull();
  });

  it("textPresetElement 以预设样式生成元素并注入内容，默认字体族不被覆盖", () => {
    const preset = findTextPreset("title") as NonNullable<ReturnType<typeof findTextPreset>>;
    const el = textPresetElement(preset, "夏日上新");
    expect(el.type).toBe("text");
    expect(el.content).toBe("夏日上新");
    expect(el.fontSize).toBe(preset.fontSize);
    expect(el.fontWeight).toBe(preset.fontWeight);
    expect(el.color).toBe(preset.color);
    expect(el.w).toBe(preset.w);
    expect(el.h).toBe(preset.h);
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(el.id).not.toBe(textPresetElement(preset, "x").id);
  });

  it("fontSampleElement 使用字体目录的 family 与字重", () => {
    const el = fontSampleElement(DESIGN_FONTS[0], "样张");
    expect(el.fontFamily).toBe(DESIGN_FONTS[0].family);
    expect(el.fontWeight).toBe(DESIGN_FONTS[0].weight);
    expect(el.content).toBe("样张");
  });
});
