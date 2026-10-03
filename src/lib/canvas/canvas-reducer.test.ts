import {
  canvasReducer,
  clampScale,
  defaultEdit,
  DEFAULT_FILTERS,
  DEFAULT_VIEW,
  initialCanvasState,
  isDirty,
  isItemDirty,
  MAX_SCALE,
  MIN_SCALE,
  normalizeCrop,
  type CanvasItem,
  type CanvasState,
} from "@/lib/canvas/canvas-reducer";
import { describe, expect, it } from "vitest";

let seq = 0;
const makeItem = (over: Partial<CanvasItem> = {}): CanvasItem => ({
  id: `item${++seq}`,
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

const stateWith = (...items: CanvasItem[]): CanvasState => ({
  ...initialCanvasState,
  items,
  selectedId: items[0]?.id ?? null,
});

describe("canvasReducer 基础", () => {
  it("初始状态为空平面、默认视图", () => {
    expect(initialCanvasState.items).toEqual([]);
    expect(initialCanvasState.selectedId).toBeNull();
    expect(initialCanvasState.view).toEqual(DEFAULT_VIEW);
  });

  it("addItems 追加条目并带默认编辑态", () => {
    const next = canvasReducer(initialCanvasState, {
      type: "addItems",
      items: [
        { id: "x1", assetId: "a", url: "/files/a.png", x: 10, y: 20, width: 320, aspect: 1.5, status: "image" },
      ],
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].edit).toEqual(defaultEdit());
    expect(next.items[0].x).toBe(10);
  });

  it("select 更新选中；未选中 null", () => {
    const itemA = makeItem({ id: "a" });
    const itemB = makeItem({ id: "b", assetId: "b", url: "/files/b.png" });
    let state = stateWith(itemA, itemB);
    expect(state.selectedId).toBe("a");
    state = canvasReducer(state, { type: "select", id: "b" });
    expect(state.selectedId).toBe("b");
    state = canvasReducer(state, { type: "select", id: null });
    expect(state.selectedId).toBeNull();
  });

  it("patchItem 原位替换（占位卡 → 图片）", () => {
    const placeholder = makeItem({ id: "p", assetId: "", url: "", status: "generating" });
    const next = canvasReducer(stateWith(placeholder), {
      type: "patchItem",
      id: "p",
      patch: { assetId: "a", url: "/files/a.png", status: "image", aspect: 1.5 },
    });
    expect(next.items[0]).toMatchObject({ assetId: "a", url: "/files/a.png", status: "image", aspect: 1.5 });
    // 位置与编辑态不变（原位替换）
    expect(next.items[0].x).toBe(0);
    expect(next.items[0].edit).toEqual(defaultEdit());
  });

  it("removeItem 移除条目；移除选中条目时清空选中", () => {
    const itemA = makeItem({ id: "a" });
    const itemB = makeItem({ id: "b", assetId: "b", url: "/files/b.png" });
    const state = stateWith(itemA, itemB);
    expect(canvasReducer(state, { type: "removeItem", id: "a" }).selectedId).toBeNull();
    const kept = canvasReducer(state, { type: "removeItem", id: "b" });
    expect(kept.selectedId).toBe("a");
    expect(kept.items).toHaveLength(1);
  });

  it("moveItem 只移动目标条目", () => {
    const itemA = makeItem({ id: "a" });
    const itemB = makeItem({ id: "b", assetId: "b", url: "/files/b.png" });
    const next = canvasReducer(stateWith(itemA, itemB), { type: "moveItem", id: "b", x: 500, y: -80 });
    expect(next.items.find((i) => i.id === "b")).toMatchObject({ x: 500, y: -80 });
    expect(next.items.find((i) => i.id === "a")?.x).toBe(0);
  });
});

describe("canvasReducer 视图与编辑", () => {
  it("setView 更新视图且缩放被钳制；resetView 回默认", () => {
    const itemA = makeItem({ id: "a" });
    const state = stateWith(itemA);
    const zoomed = canvasReducer(state, { type: "setView", view: { scale: 99, x: 40, y: -20 } });
    expect(zoomed.view.scale).toBe(MAX_SCALE);

    const reset = canvasReducer(zoomed, { type: "resetView" });
    expect(reset.view).toEqual(DEFAULT_VIEW);
  });

  it("裁剪/滤镜编辑只作用于目标条目（选中切换不串编辑）", () => {
    const itemA = makeItem({ id: "a" });
    const itemB = makeItem({ id: "b", assetId: "b", url: "/files/b.png" });
    let state = stateWith(itemA, itemB);
    state = canvasReducer(state, {
      type: "setCrop",
      id: "a",
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    });
    state = canvasReducer(state, { type: "setFilters", id: "a", filters: { brightness: 130 } });

    expect(state.items.find((i) => i.id === "a")?.edit.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
    expect(state.items.find((i) => i.id === "a")?.edit.filters).toEqual({ ...DEFAULT_FILTERS, brightness: 130 });
    expect(state.items.find((i) => i.id === "b")?.edit).toEqual(defaultEdit());

    // 切到 b 后对 b 编辑不影响 a
    state = canvasReducer(state, { type: "setFilters", id: "b", filters: { saturate: 60 } });
    expect(state.items.find((i) => i.id === "b")?.edit.filters).toEqual({ ...DEFAULT_FILTERS, saturate: 60 });
    expect(state.items.find((i) => i.id === "a")?.edit.filters.saturate).toBe(100);
  });

  it("setCrop 传 null 清除裁剪；resetFilters 回默认", () => {
    const itemA = makeItem({ id: "a" });
    let state = stateWith(itemA);
    state = canvasReducer(state, { type: "setCrop", id: "a", crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
    state = canvasReducer(state, { type: "setFilters", id: "a", filters: { contrast: 120 } });
    state = canvasReducer(state, { type: "setCrop", id: "a", crop: null });
    state = canvasReducer(state, { type: "resetFilters", id: "a" });
    expect(state.items[0].edit).toEqual(defaultEdit());
  });

  it("clear 回到初始状态", () => {
    let state = stateWith(makeItem({ id: "a" }));
    state = canvasReducer(state, { type: "setFilters", id: "a", filters: { brightness: 140 } });
    expect(canvasReducer(state, { type: "clear" })).toEqual(initialCanvasState);
  });
});

describe("isDirty / isItemDirty / clampScale", () => {
  it("未编辑、满幅裁剪、滤镜回默认都视为未修改", () => {
    let state = stateWith(makeItem({ id: "a" }));
    expect(isDirty(state)).toBe(false);
    state = canvasReducer(state, { type: "setCrop", id: "a", crop: { x: 0, y: 0, width: 1, height: 1 } });
    expect(isItemDirty(state.items[0])).toBe(false);
    state = canvasReducer(state, { type: "setFilters", id: "a", filters: { contrast: 110 } });
    expect(isDirty(state)).toBe(true);
    state = canvasReducer(state, { type: "setFilters", id: "a", filters: { contrast: 100 } });
    expect(isDirty(state)).toBe(false);
  });

  it("未选中时不可导出判定", () => {
    const state = { ...initialCanvasState, items: [makeItem({ id: "a" })], selectedId: null };
    expect(isDirty(state)).toBe(false);
  });

  it("clampScale 钳制范围并处理非法值", () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(1.5)).toBe(1.5);
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
