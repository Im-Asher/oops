import { describe, expect, it } from "vitest";
import { newElementId, type DesignDoc, type DesignElement, type TextElement } from "@/lib/design/doc";
import {
  createDesignState,
  designReducer,
  HISTORY_LIMIT,
  type DesignAction,
  type DesignState,
} from "@/lib/design/design-reducer";

/** 最小可用文本元素。 */
function text(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: newElementId(),
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
    align: "left",
    lineHeight: 1.2,
    background: null,
    ...overrides,
  };
}

function stateWith(elements: DesignElement[]): DesignState {
  const doc: DesignDoc = {
    version: 1,
    width: 800,
    height: 800,
    background: "#ffffff",
    elements,
  };
  return createDesignState(doc);
}

function reduce(state: DesignState, ...actions: DesignAction[]): DesignState {
  return actions.reduce(designReducer, state);
}

describe("designReducer 选中语义", () => {
  it("select 替换选中；toggleSelect 增删；clearSelection 清空", () => {
    const a = text({ id: "a" });
    const b = text({ id: "b" });
    let state = stateWith([a, b]);

    state = designReducer(state, { type: "select", ids: ["a"] });
    expect(state.selection).toEqual(["a"]);

    state = designReducer(state, { type: "toggleSelect", id: "b" });
    expect(state.selection).toEqual(["a", "b"]);

    state = designReducer(state, { type: "toggleSelect", id: "a" });
    expect(state.selection).toEqual(["b"]);

    state = designReducer(state, { type: "clearSelection" });
    expect(state.selection).toEqual([]);
  });
});

describe("designReducer 元素增删改", () => {
  it("addElements 入历史并按需自动选中（花字整组多选）", () => {
    const base = stateWith([]);
    const e1 = text({ id: "e1" });
    const e2 = text({ id: "e2" });

    const state = designReducer(base, { type: "addElements", elements: [e1, e2], select: true });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["e1", "e2"]);
    expect(state.selection).toEqual(["e1", "e2"]);
    expect(state.past.length).toBe(1);
  });

  it("无历史 patch（拖拽中）不改变历史；beginHistory + 无历史 patch 后 undo 回到拖拽前", () => {
    const el = text({ id: "el", x: 10, y: 10 });
    let state = stateWith([el]);

    state = designReducer(state, {
      type: "patchElements",
      patches: [{ id: "el", patch: { x: 50 } }],
    });
    expect(state.doc.elements[0].x).toBe(50);
    expect(state.past.length).toBe(0);

    // 拖拽流程：快照 → 连续无历史 patch
    state = reduce(
      state,
      { type: "beginHistory" },
      { type: "patchElements", patches: [{ id: "el", patch: { x: 60 } }] },
      { type: "patchElements", patches: [{ id: "el", patch: { x: 70 } }] },
    );
    expect(state.doc.elements[0].x).toBe(70);
    expect(state.past.length).toBe(1);

    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements[0].x).toBe(50);
  });

  it("带历史 patch（属性面板）单次入历史；undo 恢复原值", () => {
    const el = text({ id: "el", content: "旧" });
    let state = stateWith([el]);

    state = designReducer(state, {
      type: "patchElements",
      patches: [{ id: "el", patch: { content: "新", color: "#ff0000" } }],
      history: true,
    });
    expect(state.doc.elements[0].content).toBe("新");
    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements[0].content).toBe("旧");
  });

  it("deleteSelected 移除元素并清空选中，入历史", () => {
    const a = text({ id: "a" });
    const b = text({ id: "b" });
    let state = stateWith([a, b]);
    state = designReducer(state, { type: "select", ids: ["a"] });

    state = designReducer(state, { type: "deleteSelected" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["b"]);
    expect(state.selection).toEqual([]);
    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements.length).toBe(2);
  });
});

describe("designReducer 层级调整", () => {
  it("front/back 支持多选整组置顶/置底且保持组内相对顺序", () => {
    const a = text({ id: "a" });
    const b = text({ id: "b" });
    const c = text({ id: "c" });
    let state = stateWith([a, b, c]);
    state = designReducer(state, { type: "select", ids: ["a", "c"] });

    state = designReducer(state, { type: "reorder", mode: "front" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["b", "a", "c"]);

    state = designReducer(state, { type: "reorder", mode: "back" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["a", "c", "b"]);
  });

  it("forward/backward 仅单选逐层移动，到边界为 no-op", () => {
    const a = text({ id: "a" });
    const b = text({ id: "b" });
    const c = text({ id: "c" });
    let state = stateWith([a, b, c]);
    // b 在中层：forward 与 c 交换
    state = designReducer(state, { type: "select", ids: ["b"] });
    state = designReducer(state, { type: "reorder", mode: "forward" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["a", "c", "b"]);
    // b 已在顶层：forward 为 no-op（原引用返回）
    state = designReducer(state, { type: "select", ids: ["b"] });
    const topBefore = state;
    state = designReducer(state, { type: "reorder", mode: "forward" });
    expect(state).toBe(topBefore);
    // a 在底层：backward 为 no-op
    state = designReducer(state, { type: "select", ids: ["a"] });
    const bottomBefore = state;
    state = designReducer(state, { type: "reorder", mode: "backward" });
    expect(state).toBe(bottomBefore);

    // 多选逐层为 no-op
    state = designReducer(state, { type: "select", ids: ["a", "b"] });
    const multiBefore = state;
    state = designReducer(state, { type: "reorder", mode: "backward" });
    expect(state).toBe(multiBefore);
  });
});

describe("designReducer 画布与模版", () => {
  it("setCanvas 修改背景并入历史", () => {
    let state = stateWith([]);
    state = designReducer(state, { type: "setCanvas", patch: { background: "#fef3c7" } });
    expect(state.doc.background).toBe("#fef3c7");
    state = designReducer(state, { type: "undo" });
    expect(state.doc.background).toBe("#ffffff");
  });

  it("loadTemplate 整包替换元素并清空选中，undo 恢复", () => {
    const old = text({ id: "old" });
    let state = stateWith([old]);
    state = designReducer(state, { type: "select", ids: ["old"] });

    state = designReducer(state, {
      type: "loadTemplate",
      elements: [text({ id: "t1" }), text({ id: "t2" })],
    });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["t1", "t2"]);
    expect(state.selection).toEqual([]);
    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["old"]);
  });
});

describe("designReducer 撤销/重做", () => {
  it("undo 后 redo 恢复；选中按当前选中过滤到仍存在的元素", () => {
    const a = text({ id: "a" });
    let state = stateWith([]);
    state = designReducer(state, { type: "addElements", elements: [a] });

    // 选中有效元素后撤销其添加：恢复时该选中被过滤掉
    state = designReducer(state, { type: "select", ids: ["a"] });
    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements).toEqual([]);
    expect(state.selection).toEqual([]);

    // 删除后 undo：删除时已清空选中，恢复后保持为空
    state = designReducer(state, { type: "redo" });
    state = designReducer(state, { type: "select", ids: ["a"] });
    state = designReducer(state, { type: "deleteSelected" });
    state = designReducer(state, { type: "undo" });
    expect(state.doc.elements.map((el) => el.id)).toEqual(["a"]);
    expect(state.selection).toEqual([]);

    state = designReducer(state, { type: "redo" });
    expect(state.doc.elements).toEqual([]);
    expect(state.selection).toEqual([]);
  });

  it("空历史 undo / 空 future redo 为 no-op（原引用返回）", () => {
    const state = stateWith([text()]);
    expect(designReducer(state, { type: "undo" })).toBe(state);
    expect(designReducer(state, { type: "redo" })).toBe(state);
  });

  it("历史栈上限 HISTORY_LIMIT：恰好满栈可一路回溯到初始，超限丢弃最旧", () => {
    let state = stateWith([text({ id: "el" })]);
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      state = designReducer(state, {
        type: "patchElements",
        patches: [{ id: "el", patch: { x: i } }],
        history: true,
      });
    }
    expect(state.past.length).toBe(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      state = designReducer(state, { type: "undo" });
    }
    expect(state.past.length).toBe(0);
    expect(designReducer(state, { type: "undo" })).toBe(state);
    expect(state.doc.elements[0].x).toBe(0);

    // 超限：HISTORY_LIMIT+5 次操作后仍只保留 50 份快照
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      state = designReducer(state, {
        type: "patchElements",
        patches: [{ id: "el", patch: { x: i } }],
        history: true,
      });
    }
    expect(state.past.length).toBe(HISTORY_LIMIT);
  });

  it("setView 不入历史", () => {
    const state = stateWith([]);
    const next = designReducer(state, { type: "setView", view: { scale: 2, x: 10, y: 20 } });
    expect(next.view).toEqual({ scale: 2, x: 10, y: 20 });
    expect(next.past.length).toBe(0);
  });
});
