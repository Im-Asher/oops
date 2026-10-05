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
