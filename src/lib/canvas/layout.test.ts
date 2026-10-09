import { defaultEdit, type CanvasItem } from "@/lib/canvas/canvas-reducer";
import { itemRect, placeNear, placeNew } from "@/lib/canvas/layout";
import { describe, expect, it } from "vitest";

const makeItem = (over: Partial<CanvasItem> = {}): CanvasItem => ({
  id: over.id ?? "x",
  assetId: "a",
  url: "/files/a.png",
  x: 0,
  y: 0,
  width: 320,
  aspect: 1,
  status: "image",
  edit: defaultEdit(),
  ...over,
});

describe("placeNew", () => {
  it("空画布放在原点", () => {
    expect(placeNew([], 1)).toEqual({ x: 0, y: 0, width: 320, height: 320 });
  });

  it("同列向下堆叠，不覆盖既有作品", () => {
    const first = makeItem({ id: "a", x: 0, y: 0 });
    const slot = placeNew([first], 1);
    expect(slot).toEqual({ x: 0, y: 344, width: 320, height: 320 });
  });

  it("按条目宽高比计算槽位高度（行距按方形网格，逐行扫描到无冲突）", () => {
    const first = makeItem({ id: "a", x: 0, y: 0, aspect: 1.5 });
    const slot = placeNew([first], 1.5);
    // 高条目占 0..480，跨过行 1（y=344），行 2（y=688）起空闲
    expect(slot).toEqual({ x: 0, y: 688, width: 320, height: 480 });
  });

  it("槽位与任何既有条目都不相交", () => {
    const items = [
      makeItem({ id: "a", x: 0, y: 0 }),
      makeItem({ id: "b", x: 0, y: 344 }),
    ];
    const slot = placeNew(items, 1);
    const all = [...items.map(itemRect), slot];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("placeNew 锚定", () => {
  const anchor = { x: 500, y: 400 };

  it("空画布时中心对齐锚点落位", () => {
    expect(placeNew([], 1, undefined, anchor)).toEqual({
      x: 340,
      y: 240,
      width: 320,
      height: 320,
    });
  });

  it("中心被占时按 Chebyshev 环外扩，环内 (row, col) 字典序", () => {
    const center = makeItem({ id: "c", x: 340, y: 240 });
    expect(placeNew([center], 1, undefined, anchor)).toEqual({
      x: -4,
      y: -104,
      width: 320,
      height: 320,
    });
    const blocker = makeItem({ id: "b", x: -4, y: -104, assetId: "b", url: "/files/b.png" });
    expect(placeNew([center, blocker], 1, undefined, anchor)).toEqual({
      x: 340,
      y: -104,
      width: 320,
      height: 320,
    });
  });

  it("无锚点时保持原点列优先行为", () => {
    const first = makeItem({ id: "a", x: 0, y: 0 });
    expect(placeNew([first], 1, undefined)).toEqual({ x: 0, y: 344, width: 320, height: 320 });
  });

  it("连续多张在锚点周围环排且互不重叠", () => {
    const first = placeNew([], 1, undefined, anchor);
    const second = placeNew([makeItem({ id: "i1", x: first.x, y: first.y })], 1, undefined, anchor);
    const third = placeNew(
      [
        makeItem({ id: "i1", x: first.x, y: first.y }),
        makeItem({ id: "i2", x: second.x, y: second.y, assetId: "b", url: "/files/b.png" }),
      ],
      1,
      undefined,
      anchor,
    );
    expect(second).toEqual({ x: -4, y: -104, width: 320, height: 320 });
    expect(third).toEqual({ x: 340, y: -104, width: 320, height: 320 });
    const slots = [first, second, third];
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("placeNear", () => {
  it("首个版本放在源图右侧，源图位置不变", () => {
    const source = makeItem({ id: "s", x: 0, y: 0 });
    const slot = placeNear(source, [source], 1);
    expect(slot).toEqual({ x: 344, y: 0, width: 320, height: 320 });
  });

  it("同源多版本向下依次排列", () => {
    const source = makeItem({ id: "s", x: 0, y: 0 });
    const v1 = makeItem({ id: "v1", x: 344, y: 0, referenceAssetId: "a" });
    const slot = placeNear(source, [source, v1], 1);
    expect(slot).toEqual({ x: 344, y: 344, width: 320, height: 320 });
  });

  it("右侧被占用时向下寻找空闲位，不与任何条目相交", () => {
    const source = makeItem({ id: "s", x: 0, y: 0 });
    const blocker = makeItem({ id: "b", x: 344, y: 0, assetId: "b", url: "/files/b.png" });
    const slot = placeNear(source, [source, blocker], 1);
    expect(slot.y).toBeGreaterThan(0);
    const overlap =
      slot.x < 344 + 320 && 344 < slot.x + slot.width && slot.y < 320 && 0 < slot.y + slot.height;
    expect(overlap).toBe(false);
  });
});
