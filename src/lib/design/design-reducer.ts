/**
 * 设计编辑器 reducer：文档 + 选中 + 视图 + 撤销/重做历史。
 * 历史只快照文档（视图/选中为 UI 态不入栈）；拖拽等连续操作用
 * beginHistory 快照 + 无历史 patch 完成一次 undo 粒度。
 */
import type { DesignDoc, DesignElement } from "@/lib/design/doc";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** 历史快照上限：超出后丢弃最旧快照。 */
export const HISTORY_LIMIT = 50;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export interface DesignView {
  scale: number;
  /** 画布容器内偏移（屏幕 px），同 /canvas 视图约定。 */
  x: number;
  y: number;
}

export interface DesignState {
  doc: DesignDoc;
  /** 选中元素 id（花字整组多选）。 */
  selection: string[];
  view: DesignView;
  past: DesignDoc[];
  future: DesignDoc[];
}

export interface ElementPatchEntry {
  id: string;
  patch: Partial<DesignElement>;
}

export type ReorderMode = "front" | "back" | "forward" | "backward";

export type DesignAction =
  | { type: "select"; ids: string[] }
  | { type: "toggleSelect"; id: string }
  | { type: "clearSelection" }
  /** 平移/缩放视图：不入历史。 */
  | { type: "setView"; view: DesignView }
  /** 追加元素（插入预设）；select = 插入后自动选中（花字整组多选）。 */
  | { type: "addElements"; elements: DesignElement[]; select?: boolean }
  /** 整包替换元素（加载模版）。 */
  | { type: "loadTemplate"; elements: DesignElement[] }
  /** 拖拽开始前快照：随后的无历史 patch 共享同一撤销粒度。 */
  | { type: "beginHistory" }
  | { type: "patchElements"; patches: ElementPatchEntry[]; history?: boolean }
  | { type: "deleteSelected" }
  | { type: "reorder"; mode: ReorderMode }
  | { type: "setCanvas"; patch: Partial<Pick<DesignDoc, "width" | "height" | "background">> }
  | { type: "undo" }
  | { type: "redo" };

export function createDesignState(doc: DesignDoc): DesignState {
  return {
    doc,
    selection: [],
    view: { scale: 1, x: 0, y: 0 },
    past: [],
    future: [],
  };
}

function pushHistory(state: DesignState): Pick<DesignState, "past" | "future"> {
  return {
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
  };
}

function filterSelection(selection: string[], doc: DesignDoc): string[] {
  if (selection.length === 0) return selection;
  const ids = new Set(doc.elements.map((el) => el.id));
  return selection.filter((id) => ids.has(id));
}

function reorderElements(
  elements: DesignElement[],
  selection: string[],
  mode: ReorderMode,
): DesignElement[] {
  const selectedSet = new Set(selection);
  const selectedInOrder = elements.filter((el) => selectedSet.has(el.id));
  const others = elements.filter((el) => !selectedSet.has(el.id));
  switch (mode) {
    case "front":
      return [...others, ...selectedInOrder];
    case "back":
      return [...selectedInOrder, ...others];
    case "forward":
    case "backward": {
      // 逐层移动仅支持单选：多选的整组相邻交换语义含糊，二期随组合能力再定。
      if (selection.length !== 1) return elements;
      const index = elements.findIndex((el) => el.id === selection[0]);
      const target = mode === "forward" ? index + 1 : index - 1;
      if (index < 0 || target < 0 || target >= elements.length) return elements;
      const next = [...elements];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    }
  }
}

export function designReducer(state: DesignState, action: DesignAction): DesignState {
  switch (action.type) {
    case "select":
      return { ...state, selection: action.ids };
    case "toggleSelect": {
      const selection = state.selection.includes(action.id)
        ? state.selection.filter((id) => id !== action.id)
        : [...state.selection, action.id];
      return { ...state, selection };
    }
    case "clearSelection":
      return state.selection.length === 0 ? state : { ...state, selection: [] };
    case "setView":
      return { ...state, view: { ...action.view, scale: clampScale(action.view.scale) } };
    case "addElements": {
      if (action.elements.length === 0) return state;
      const ids = action.elements.map((el) => el.id);
      return {
        ...state,
        ...pushHistory(state),
        doc: { ...state.doc, elements: [...state.doc.elements, ...action.elements] },
        selection: action.select ? ids : state.selection,
      };
    }
    case "loadTemplate": {
      return {
        ...state,
        ...pushHistory(state),
        doc: { ...state.doc, elements: action.elements },
        selection: [],
      };
    }
    case "beginHistory":
      return { ...state, ...pushHistory(state) };
    case "patchElements": {
      if (action.patches.length === 0) return state;
      const patchById = new Map(action.patches.map((entry) => [entry.id, entry.patch]));
      const elements = state.doc.elements.map((element) => {
        const patch = patchById.get(element.id);
        return patch ? ({ ...element, ...patch } as DesignElement) : element;
      });
      const doc = { ...state.doc, elements };
      return action.history ? { ...state, ...pushHistory(state), doc } : { ...state, doc };
    }
    case "deleteSelected": {
      if (state.selection.length === 0) return state;
      const selectedSet = new Set(state.selection);
      return {
        ...state,
        ...pushHistory(state),
        doc: {
          ...state.doc,
          elements: state.doc.elements.filter((el) => !selectedSet.has(el.id)),
        },
        selection: [],
      };
    }
    case "reorder": {
      const elements = reorderElements(state.doc.elements, state.selection, action.mode);
      if (elements === state.doc.elements) return state;
      return { ...state, ...pushHistory(state), doc: { ...state.doc, elements } };
    }
    case "setCanvas": {
      return {
        ...state,
        ...pushHistory(state),
        doc: { ...state.doc, ...action.patch },
      };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const past = [...state.past];
      const doc = past.pop() as DesignDoc;
      return {
        ...state,
        doc,
        past,
        future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
        selection: filterSelection(state.selection, doc),
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [doc, ...future] = state.future;
      return {
        ...state,
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future,
        selection: filterSelection(state.selection, doc),
      };
    }
  }
}
