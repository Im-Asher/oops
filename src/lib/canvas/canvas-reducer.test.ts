import {
  canvasReducer,
  DEFAULT_FILTERS,
  DEFAULT_VIEW,
  initialCanvasState,
  isDirty,
  normalizeCrop,
  type CanvasState,
} from "@/lib/canvas/canvas-reducer";
import { describe, expect, it } from "vitest";

const imageA = { assetId: "a", url: "/files/a.png" };
const imageB = { assetId: "b", url: "/files/b.png" };

const zoomed = (): CanvasState => ({
  ...initialCanvasState,
  active: imageA,
  view: { scale: 2.5, x: 40, y: -20 },
});

describe("canvasReducer", () => {
  it("初始状态无激活图、视图与滤镜均为默认", () => {
    expect(initialCanvasState.active).toBeNull();
    expect(initialCanvasState.view).toEqual(DEFAULT_VIEW);
    expect(initialCanvasState.edit.filters).toEqual(DEFAULT_FILTERS);
    expect(initialCanvasState.edit.crop).toBeNull();
  });

  it("上屏设置激活图", () => {
    const next = canvasReducer(initialCanvasState, { type: "activate", image: imageA });
    expect(next.active).toEqual(imageA);
  });

  it("重复上屏同一张图不重置视图与编辑态", () => {
    const state: CanvasState = {
      ...zoomed(),
      edit: { crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, filters: { ...DEFAULT_FILTERS, brightness: 130 } },
    };
    const next = canvasReducer(state, { type: "activate", image: imageA });
    expect(next).toBe(state);
  });

  it("切换到另一张图会重置视图与编辑态", () => {
    const state: CanvasState = {
      ...zoomed(),
      edit: { crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, filters: { ...DEFAULT_FILTERS, saturate: 40 } },
    };
    const next = canvasReducer(state, { type: "activate", image: imageB });
    expect(next.active).toEqual(imageB);
    expect(next.view).toEqual(DEFAULT_VIEW);
    expect(next.edit.crop).toBeNull();
    expect(next.edit.filters).toEqual(DEFAULT_FILTERS);
  });

  it("setView 与 resetView 只影响视图", () => {
    const moved = canvasReducer(zoomed(), { type: "setView", view: { scale: 1.5, x: 5, y: 5 } });
    expect(moved.view).toEqual({ scale: 1.5, x: 5, y: 5 });
    expect(moved.active).toEqual(imageA);

    const reset = canvasReducer(moved, { type: "resetView" });
    expect(reset.view).toEqual(DEFAULT_VIEW);
  });

  it("裁剪可设置与清除", () => {
    const cropped = canvasReducer(zoomed(), {
      type: "setCrop",
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    });
    expect(cropped.edit.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });

    const cleared = canvasReducer(cropped, { type: "clearCrop" });
    expect(cleared.edit.crop).toBeNull();
  });

  it("setFilters 按字段局部合并，resetFilters 回到默认", () => {
    const partial = canvasReducer(zoomed(), { type: "setFilters", filters: { brightness: 120 } });
    expect(partial.edit.filters).toEqual({ brightness: 120, contrast: 100, saturate: 100 });

    const further = canvasReducer(partial, { type: "setFilters", filters: { saturate: 60 } });
    expect(further.edit.filters).toEqual({ brightness: 120, contrast: 100, saturate: 60 });

    expect(canvasReducer(further, { type: "resetFilters" }).edit.filters).toEqual(DEFAULT_FILTERS);
  });

  it("clear 回到初始状态（含已存在的裁剪与滤镜）", () => {
    let state = canvasReducer(zoomed(), {
      type: "setCrop",
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    });
    state = canvasReducer(state, { type: "setFilters", filters: { brightness: 140 } });
    expect(isDirty(state)).toBe(true);

    expect(canvasReducer(state, { type: "clear" })).toEqual(initialCanvasState);
  });
});

describe("normalizeCrop", () => {
  it("钳制越界坐标，保证矩形落在原图内", () => {
    expect(normalizeCrop({ x: -0.2, y: -0.1, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    // 用二进制精确值（0.75/0.5）避免浮点尾差
    expect(normalizeCrop({ x: 0.75, y: 0.5, width: 0.9, height: 0.9 })).toEqual({
      x: 0.75,
      y: 0.5,
      width: 0.25,
      height: 0.5,
    });
  });

  it("退化为空的矩形视为未裁剪", () => {
    expect(normalizeCrop({ x: 0.5, y: 0.5, width: 0, height: 0 })).toBeNull();
    expect(normalizeCrop({ x: 0.5, y: 0.5, width: Number.NaN, height: 0.2 })).toBeNull();
  });

  it("非法数值回落为 0 而非 NaN", () => {
    const rect = normalizeCrop({
      x: Number.NaN,
      y: Number.NaN,
      width: 0.5,
      height: 0.5,
    });
    expect(rect).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });
});

describe("isDirty", () => {
  it("未编辑时不可导出", () => {
    expect(isDirty(zoomed())).toBe(false);
  });

  it("有实际裁剪即已修改", () => {
    const cropped = canvasReducer(zoomed(), {
      type: "setCrop",
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    });
    expect(isDirty(cropped)).toBe(true);
  });

  it("满幅裁剪与原图等价，不算修改", () => {
    const fullFrame = canvasReducer(zoomed(), {
      type: "setCrop",
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(fullFrame.edit.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(isDirty(fullFrame)).toBe(false);
  });

  it("滤镜偏离默认值即已修改", () => {
    const filtered = canvasReducer(zoomed(), { type: "setFilters", filters: { contrast: 110 } });
    expect(isDirty(filtered)).toBe(true);
  });

  it("滤镜调回默认值不算修改", () => {
    const filtered = canvasReducer(zoomed(), { type: "setFilters", filters: { contrast: 110 } });
    const restored = canvasReducer(filtered, { type: "setFilters", filters: { contrast: 100 } });
    expect(isDirty(restored)).toBe(false);
  });

  it("裁剪与滤镜都撤销后回到未修改", () => {
    let state = canvasReducer(zoomed(), {
      type: "setCrop",
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    state = canvasReducer(state, { type: "setFilters", filters: { brightness: 130 } });
    expect(isDirty(state)).toBe(true);

    state = canvasReducer(state, { type: "clearCrop" });
    state = canvasReducer(state, { type: "resetFilters" });
    expect(isDirty(state)).toBe(false);
  });
});
