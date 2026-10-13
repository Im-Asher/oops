import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_FAMILY,
  DESIGN_FONTS,
  ensureFontLoaded,
  findFont,
} from "@/lib/design/fonts";

describe("字体目录", () => {
  it("包含得意黑与霞鹜文楷，family 带 @font-face 一致的引号", () => {
    expect(DESIGN_FONTS.map((f) => f.id)).toEqual(["smiley-sans", "lxgw-wenkai"]);
    expect(findFont("smiley-sans")?.family).toBe("'Smiley Sans'");
    expect(findFont("lxgw-wenkai")?.family).toBe("'LXGW WenKai'");
    expect(findFont("not-exist")).toBeNull();
  });

  it("默认字体为系统 sans 栈", () => {
    expect(DEFAULT_FONT_FAMILY).toContain("sans-serif");
  });
});

describe("ensureFontLoaded 字体预热", () => {
  it("返回布尔且不抛错（jsdom 无 FontFaceSet 时降级 false）", async () => {
    const font = DESIGN_FONTS[0];
    const result = await ensureFontLoaded(font);
    expect(typeof result).toBe("boolean");
  });
});
