import { DEFAULT_FILTERS, type Filters } from "@/lib/canvas/canvas-reducer";
import {
  FILTER_PRESETS,
  filtersToCss,
  filtersToCssOrNone,
} from "@/lib/canvas/filter-string";
import { describe, expect, it } from "vitest";

const base: Filters = { ...DEFAULT_FILTERS };

describe("filtersToCss", () => {
  it("输出与 ctx.filter 兼容的 CSS filter 串", () => {
    expect(filtersToCss({ ...base, brightness: 120, contrast: 90, saturate: 80 })).toBe(
      "brightness(120%) contrast(90%) saturate(80%)",
    );
  });

  it("sepia 为 0 时不输出，hueRotate 非 0 才输出", () => {
    expect(filtersToCss(base)).not.toContain("sepia");
    expect(filtersToCss(base)).not.toContain("hue-rotate");

    expect(filtersToCss({ ...base, sepia: 15 })).toContain("sepia(15%)");
    expect(filtersToCss({ ...base, hueRotate: -8 })).toContain("hue-rotate(-8deg)");
  });

  it("默认参数视为无滤镜，返回 undefined", () => {
    expect(filtersToCssOrNone(base)).toBeUndefined();
    expect(filtersToCssOrNone({ ...base, brightness: 101 })).toBe(
      "brightness(101%) contrast(100%) saturate(100%)",
    );
  });
});

describe("FILTER_PRESETS", () => {
  it("含设计稿要求的六组预设", () => {
    expect(FILTER_PRESETS.map((p) => p.label)).toEqual([
      "原图",
      "鲜明",
      "柔和",
      "暖调",
      "冷调",
      "黑白",
    ]);
  });

  it("原图预设等于默认参数（应用后不算修改）", () => {
    expect(FILTER_PRESETS[0]?.filters).toEqual(DEFAULT_FILTERS);
  });

  it("暖调用 sepia、冷调用 hue-rotate", () => {
    expect(FILTER_PRESETS.find((p) => p.id === "warm")?.filters.sepia).toBeGreaterThan(0);
    expect(FILTER_PRESETS.find((p) => p.id === "cool")?.filters.hueRotate).not.toBe(0);
  });
});
