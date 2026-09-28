/**
 * 画布工作台 UI 状态：激活图与视图变换。
 * 全部为会话页内存状态，不落库（design 决策 6）。
 */

export interface CanvasImage {
  assetId: string;
  url: string;
}

export interface CanvasView {
  scale: number;
  x: number;
  y: number;
}

export interface CanvasState {
  active: CanvasImage | null;
  view: CanvasView;
}

export type CanvasAction =
  | { type: "activate"; image: CanvasImage }
  | { type: "clear" }
  | { type: "setView"; view: CanvasView }
  | { type: "resetView" };

export const DEFAULT_VIEW: CanvasView = { scale: 1, x: 0, y: 0 };

/** 缩放区间 25%~400%（canvas-workspace spec）。 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export const initialCanvasState: CanvasState = { active: null, view: DEFAULT_VIEW };

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    // 同一张图重复上屏不重置视图，避免误触丢失缩放位置。
    // 以 url 判等：assetId 在服务端缺失时会是空串，多图无法区分。
    case "activate":
      if (state.active?.url === action.image.url) return state;
      return { active: action.image, view: { ...DEFAULT_VIEW } };
    case "clear":
      return initialCanvasState;
    case "setView":
      return { ...state, view: action.view };
    case "resetView":
      return { ...state, view: { ...DEFAULT_VIEW } };
  }
}
