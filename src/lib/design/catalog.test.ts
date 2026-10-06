import { describe, expect, it } from "vitest";
import { parseDesignDoc } from "@/lib/design/doc";
import { DESIGN_FONTS } from "@/lib/design/fonts";
import { FANCY_TEXT_PRESETS } from "@/lib/design/fancy-text";
import { DESIGN_TEMPLATES } from "@/lib/design/templates";

const FAMILIES = new Set(DESIGN_FONTS.map((f) => f.family));

describe("花字预设目录", () => {
  it("build 产物为可解析的合法元素，且 id 互不相同", () => {
    for (const preset of FANCY_TEXT_PRESETS) {
      const contents = preset.contentKeys.map((key) => `${preset.id}-${key}-文案`);
      const elements = preset.build(contents);
      expect(elements.length).toBeGreaterThan(0);
      const ids = elements.map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
      // 借 parseDesignDoc 校验元素合法性（包裹成完整文档）
      const doc = {
        version: 1,
        width: 1000,
        height: 1000,
        background: "#ffffff",
        elements,
      };
      expect(parseDesignDoc(doc)?.elements).toEqual(elements);
    }
  });

  it("花字 id 唯一（词典 key 依赖）", () => {
    const ids = FANCY_TEXT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("促销大字消费两个文案（label + price）", () => {
    const blast = FANCY_TEXT_PRESETS.find((p) => p.id === "blast");
    expect(blast?.contentKeys).toEqual(["label", "price"]);
    const elements = blast?.build(["直降", "¥99"]) ?? [];
    expect(elements.length).toBe(2);
  });
});

describe("模版目录", () => {
  it("模版 doc 可被 parser 完整解析且 baseWidth 与文档宽一致", () => {
    for (const template of DESIGN_TEMPLATES) {
      expect(parseDesignDoc(template.doc)).toEqual(template.doc);
      expect(template.baseWidth).toBe(template.doc.width);
    }
  });

  it("模版元素 id 在模版内唯一", () => {
    for (const template of DESIGN_TEMPLATES) {
      const ids = template.doc.elements.map((el) => el.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("模版首层为全幅背景 rect（画布背景色保持用户设置）", () => {
    for (const template of DESIGN_TEMPLATES) {
      const first = template.doc.elements[0];
      expect(first.type).toBe("shape");
      expect(first.x).toBe(0);
      expect(first.y).toBe(0);
      expect(first.w).toBe(template.doc.width);
      expect(first.h).toBe(template.doc.height);
    }
  });

  it("模版字体均来自字体目录或默认字体栈", () => {
    for (const template of DESIGN_TEMPLATES) {
      for (const el of template.doc.elements) {
        if (el.type === "text") {
          const known = FAMILIES.has(el.fontFamily) || el.fontFamily.includes("font-geist-sans");
          expect(known).toBe(true);
        }
      }
    }
  });
});
