import { describe, expect, it } from "vitest";
import { assetImageElement } from "./asset-handoff";

const canvas = { width: 1000, height: 1000, center: { x: 500, y: 500 } };

describe("assetImageElement", () => {
  it("以画布中心为落点居中插入", () => {
    const el = assetImageElement(
      { id: "a1", url: "/files/a.png", width: 400, height: 400 },
      canvas,
    );
    expect(el.type).toBe("image");
    expect(el.src).toBe("/files/a.png");
    // 方形图：宽=高，且中心与画布中心重合
    expect(el.w).toBe(el.h);
    expect(el.x + el.w / 2).toBe(500);
    expect(el.y + el.h / 2).toBe(500);
  });

  it("按资产宽高比等比缩放", () => {
    const wide = assetImageElement(
      { id: "a2", url: "/files/w.png", width: 1600, height: 900 },
      canvas,
    );
    expect(wide.w / wide.h).toBeCloseTo(1600 / 900, 1);
    const tall = assetImageElement(
      { id: "a3", url: "/files/t.png", width: 900, height: 1600 },
      canvas,
    );
    expect(tall.h / tall.w).toBeCloseTo(1600 / 900, 1);
  });

  it("不超出画布尺寸上限", () => {
    const huge = assetImageElement(
      { id: "a4", url: "/files/h.png", width: 9999, height: 9999 },
      canvas,
    );
    // MAX_RATIO=0.8 → 800
    expect(huge.w).toBe(800);
    expect(huge.h).toBe(800);
    expect(huge.x).toBeGreaterThanOrEqual(0);
    expect(huge.y).toBeGreaterThanOrEqual(0);
  });

  it("宽高未知时按 1:1 兜底，不抛错", () => {
    const el = assetImageElement(
      { id: "a5", url: "/files/u.png", width: null, height: null },
      canvas,
    );
    expect(el.w).toBe(el.h);
    const zeroHeight = assetImageElement(
      { id: "a6", url: "/files/z.png", width: 100, height: 0 },
      canvas,
    );
    expect(zeroHeight.w).toBe(zeroHeight.h);
  });

  it("每次插入生成独立 id，便于撤销栈逐层回退", () => {
    const a = assetImageElement({ id: "x", url: "/x.png", width: 10, height: 10 }, canvas);
    const b = assetImageElement({ id: "x", url: "/x.png", width: 10, height: 10 }, canvas);
    expect(a.id).not.toBe(b.id);
  });

  it("默认参数：不旋转、全不透明、无圆角", () => {
    const el = assetImageElement({ id: "a7", url: "/a.png", width: 10, height: 10 }, canvas);
    expect(el.rotation).toBe(0);
    expect(el.opacity).toBe(1);
    expect(el.radius).toBe(0);
    expect(el.fit).toBe("contain");
  });
});