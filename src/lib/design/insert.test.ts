import { describe, expect, it } from "vitest";
import type { ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";
import {
  centerFragmentAt,
  fragmentBounds,
  scaleTemplateElements,
  viewportCenterToCanvas,
} from "@/lib/design/insert";

function text(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: "t",
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    rotation: 0,
    opacity: 1,
    type: "text",
    content: "文案",
    fontFamily: "system-ui",
    fontSize: 24,
    fontWeight: 400,
    color: "#111111",
    align: "center",
    lineHeight: 1.2,
    background: null,
    ...overrides,
  };
}

function image(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: "img",
    x: 0,
    y: 0,
    w: 60,
    h: 60,
    rotation: 0,
    opacity: 1,
    type: "image",
    src: "/design-materials/badge.svg",
    fit: "contain",
    radius: 4,
    ...overrides,
  };
}

function shape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: "s",
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    rotation: 0,
    opacity: 1,
    type: "shape",
    kind: "rect",
    fill: "#f97316",
    radius: 8,
    ...overrides,
  };
}

describe("viewportCenterToCanvas 视口中心换算", () => {
  it("零偏移 scale=1 时即容器几何中心", () => {
    expect(viewportCenterToCanvas({ width: 800, height: 600 }, { scale: 1, x: 0, y: 0 })).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("带偏移与缩放时按画布坐标换算", () => {
    // screen = canvas * scale + offset → canvas = (screen - offset) / scale
    const view = { scale: 0.5, x: 100, y: 50 };
    expect(viewportCenterToCanvas({ width: 800, height: 600 }, view)).toEqual({ x: 600, y: 500 });
  });
});

describe("centerFragmentAt 片段居中", () => {
  it("包围盒中心平移到目标点，元素间相对位置保持", () => {
    const a = text({ id: "a", x: 0, y: 0, w: 100, h: 40 });
    const b = text({ id: "b", x: 100, y: 40, w: 100, h: 40 });
    const centered = centerFragmentAt([a, b], { x: 400, y: 300 });

    const bounds = fragmentBounds(centered);
    expect(bounds?.x).toBe(300); // 400 - 200/2（包围盒宽 200）
    expect(bounds?.y).toBe(260); // 300 - 80/2
    expect(centered[1].x - centered[0].x).toBe(100);
    expect(centered[1].y - centered[0].y).toBe(40);
  });

  it("空片段返回空数组", () => {
    expect(centerFragmentAt([], { x: 10, y: 10 })).toEqual([]);
  });
});

describe("scaleTemplateElements 模版等比缩放", () => {
  it("几何 + 字号 + 胶囊内边距/圆角 + 图片圆角同步缩放，语义属性不变", () => {
    const elements = [
      text({
        id: "t",
        x: 40,
        y: 80,
        w: 400,
        h: 60,
        fontSize: 48,
        background: { color: "#fff", radius: 30, paddingX: 16, paddingY: 8 },
        content: "文案",
        fontFamily: "'Smiley Sans'",
      }),
      image({ x: 100, y: 100, w: 60, h: 60, radius: 6 }),
      shape({ x: 0, y: 0, w: 800, h: 800, radius: null }),
    ];
    const scaled = scaleTemplateElements(elements, 400, 200); // k = 0.5
    const t = scaled[0] as TextElement;
    expect(t.x).toBe(20);
    expect(t.w).toBe(200);
    expect(t.fontSize).toBe(24);
    expect(t.background).toEqual({ color: "#fff", radius: 15, paddingX: 8, paddingY: 4 });
    expect(t.content).toBe("文案");
    expect((scaled[1] as ImageElement).radius).toBe(3);
    expect((scaled[2] as ShapeElement).radius).toBeNull();
  });

  it("k=1 时返回元素副本（值不变）", () => {
    const elements = [text({ x: 10 })];
    const scaled = scaleTemplateElements(elements, 800, 800);
    expect(scaled).not.toBe(elements);
    expect(scaled[0]).toEqual(elements[0]);
  });
});
