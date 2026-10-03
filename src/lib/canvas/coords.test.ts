import {
  canvasToScreen,
  fitView,
  panView,
  rectVisibleInViewport,
  screenToCanvas,
  zoomAtPoint,
} from "@/lib/canvas/coords";
import { DEFAULT_VIEW, MAX_SCALE } from "@/lib/canvas/canvas-reducer";
import { describe, expect, it } from "vitest";

describe("screenToCanvas / canvasToScreen", () => {
  it("任意缩放与偏移下双向换算互逆", () => {
    const view = { scale: 2.5, x: 40, y: -20 };
    const screen = { x: 123, y: -77 };
    const canvas = screenToCanvas(screen, view);
    expect(canvasToScreen(canvas, view)).toEqual(screen);
  });

  it("scale=1 且无偏移时坐标一致", () => {
    expect(screenToCanvas({ x: 30, y: 50 }, DEFAULT_VIEW)).toEqual({ x: 30, y: 50 });
  });
});

describe("zoomAtPoint", () => {
  it("缩放前后锚点指向的画布内容不动（指针中心缩放）", () => {
    const view = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 300, y: 200 };
    const next = zoomAtPoint(view, 2, anchor);
    expect(screenToCanvas(anchor, view)).toEqual(screenToCanvas(anchor, next));
  });

  it("连续缩放后拖动不错位：内容坐标换算稳定", () => {
    let view = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 150, y: 150 };
    view = zoomAtPoint(view, 1.5, anchor);
    view = zoomAtPoint(view, 0.8, anchor);
    const content = screenToCanvas(anchor, view);
    expect(canvasToScreen(content, view)).toEqual(anchor);
  });

  it("缩放被钳制到上限", () => {
    const next = zoomAtPoint(DEFAULT_VIEW, 999, { x: 0, y: 0 });
    expect(next.scale).toBe(MAX_SCALE);
  });
});

describe("panView / fitView", () => {
  it("panView 累加偏移不改缩放", () => {
    expect(panView({ scale: 2, x: 10, y: 20 }, -30, 5)).toEqual({ scale: 2, x: -20, y: 25 });
  });

  it("fitView 将全部条目放进视口并居中", () => {
    const view = fitView(
      [
        { x: 0, y: 0, width: 320, height: 320 },
        { x: 344, y: 0, width: 320, height: 320 },
      ],
      { width: 1200, height: 800 },
    );
    expect(view).not.toBeNull();
    if (!view) return;
    // 包围盒 664x320，pad 40：scale = min(1120/664, 720/320) = 720/320 = 2.25 → 钳制后仍 2.25? MAX=4 不触发
    const boundsW = 664;
    expect(view.scale).toBeCloseTo(Math.min((1200 - 80) / boundsW, (800 - 80) / 320), 5);
    // 居中后包围盒左边缘 >= 0
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
  });

  it("fitView 空条目或退化包围盒返回 null", () => {
    expect(fitView([], { width: 800, height: 600 })).toBeNull();
    expect(fitView([{ x: 0, y: 0, width: 0, height: 0 }], { width: 800, height: 600 })).toBeNull();
  });
});

describe("rectVisibleInViewport", () => {
  const view = { scale: 1, x: 0, y: 0 };
  const viewport = { width: 800, height: 600 };

  it("完整可见", () => {
    expect(rectVisibleInViewport({ x: 10, y: 10, width: 320, height: 320 }, view, viewport)).toBe(true);
  });

  it("部分越界视为不可见（触发定位提示）", () => {
    expect(rectVisibleInViewport({ x: 700, y: 10, width: 320, height: 320 }, view, viewport)).toBe(false);
    expect(rectVisibleInViewport({ x: -50, y: 10, width: 320, height: 320 }, view, viewport)).toBe(false);
  });
});
