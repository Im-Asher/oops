import { describe, expect, it } from "vitest";
import {
  createEmptyDoc,
  newElementId,
  parseDesignDoc,
  type DesignDoc,
} from "@/lib/design/doc";

/** 构造合法样例文档：含文本（带/不带胶囊底色）、图片、形状三类元素。 */
function validDoc(): DesignDoc {
  return {
    version: 1,
    width: 800,
    height: 800,
    background: "#ffffff",
    elements: [
      {
        id: "bg-1",
        x: 0,
        y: 0,
        w: 800,
        h: 800,
        rotation: 0,
        opacity: 1,
        type: "shape",
        kind: "rect",
        fill: "#fde68a",
        radius: null,
      },
      {
        id: "t-1",
        x: 100,
        y: 200,
        w: 300,
        h: 60,
        rotation: 0,
        opacity: 1,
        type: "text",
        content: "限时特惠",
        fontFamily: "'Smiley Sans'",
        fontSize: 48,
        fontWeight: 700,
        color: "#111111",
        align: "center",
        lineHeight: 1.2,
        background: { color: "#ffffff", radius: 30, paddingX: 16, paddingY: 8 },
      },
      {
        id: "t-2",
        x: 100,
        y: 300,
        w: 200,
        h: 40,
        rotation: 0,
        opacity: 1,
        type: "text",
        content: "第二行",
        fontFamily: "system-ui",
        fontSize: 24,
        fontWeight: 400,
        color: "#333333",
        align: "left",
        lineHeight: 1,
        background: null,
      },
      {
        id: "img-1",
        x: 300,
        y: 400,
        w: 120,
        h: 120,
        rotation: 15,
        opacity: 0.9,
        type: "image",
        src: "/design-materials/badge-sale.svg",
        fit: "contain",
        radius: 8,
      },
    ],
  };
}

describe("parseDesignDoc 严格解析", () => {
  it("合法文档（三类元素 + 胶囊底色）完整通过且字段保持", () => {
    const doc = validDoc();
    const parsed = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
  });

  it("createEmptyDoc 产物可被 parser 接受（白底空白画布）", () => {
    expect(parseDesignDoc(createEmptyDoc(1242, 2208))).toEqual(createEmptyDoc(1242, 2208));
  });

  it("非对象 / version 不符 / 尺寸非法 / 背景非法 → null", () => {
    expect(parseDesignDoc(null)).toBeNull();
    expect(parseDesignDoc("doc")).toBeNull();
    expect(parseDesignDoc({ ...validDoc(), version: 2 })).toBeNull();
    expect(parseDesignDoc({ ...validDoc(), width: 0 })).toBeNull();
    expect(parseDesignDoc({ ...validDoc(), height: -1 })).toBeNull();
    expect(parseDesignDoc({ ...validDoc(), background: 42 })).toBeNull();
  });

  it("elements 非数组或含任一非法元素 → 整体拒绝", () => {
    expect(parseDesignDoc({ ...validDoc(), elements: "nope" })).toBeNull();
    const missingType = validDoc();
    delete (missingType.elements[1] as Record<string, unknown>).type;
    expect(parseDesignDoc(missingType)).toBeNull();
    expect(parseDesignDoc({ ...validDoc(), elements: [{ type: "video" }] })).toBeNull();
  });

  it("元素几何非法：非有限坐标 / 尺寸非正 / opacity 越界 → 拒绝", () => {
    const badX = validDoc();
    (badX.elements[1] as unknown as { x: number }).x = Number.NaN;
    expect(parseDesignDoc(badX)).toBeNull();

    const badW = validDoc();
    (badW.elements[2] as unknown as { w: number }).w = 0;
    expect(parseDesignDoc(badW)).toBeNull();

    const badOpacity = validDoc();
    (badOpacity.elements[3] as unknown as { opacity: number }).opacity = 1.5;
    expect(parseDesignDoc(badOpacity)).toBeNull();
  });

  it("文本元素非法：缺内容 / 空字体 / 非法 align / 胶囊底色字段坏 → 拒绝", () => {
    const noContent = validDoc();
    (noContent.elements[1] as unknown as { content: number }).content = 1;
    expect(parseDesignDoc(noContent)).toBeNull();

    const badAlign = validDoc();
    (badAlign.elements[2] as unknown as { align: string }).align = "justify";
    expect(parseDesignDoc(badAlign)).toBeNull();

    const badBg = validDoc();
    (badBg.elements[1] as unknown as { background: unknown }).background = { color: 1 };
    expect(parseDesignDoc(badBg)).toBeNull();
  });

  it("图片/形状元素非法：坏 fit / 坏 kind / 负 radius → 拒绝", () => {
    const badFit = validDoc();
    (badFit.elements[3] as unknown as { fit: string }).fit = "fill";
    expect(parseDesignDoc(badFit)).toBeNull();

    const badKind = validDoc();
    (badKind.elements[0] as unknown as { kind: string }).kind = "polygon";
    expect(parseDesignDoc(badKind)).toBeNull();

    const badRadius = validDoc();
    (badRadius.elements[3] as unknown as { radius: number }).radius = -2;
    expect(parseDesignDoc(badRadius)).toBeNull();
  });
});

describe("newElementId", () => {
  it("生成非空且互不相同的 id", () => {
    const a = newElementId();
    const b = newElementId();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
