/**
 * 画布工作台 UI 状态：激活图、视图变换与编辑态。
 * 全部为会话页内存状态，不落库（design 决策 6）；仅导出时产生新 asset。
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

/**
 * 裁剪矩形，归一化到原图 0~1。
 * 归一化而非像素：预览受视图缩放影响，导出按原图分辨率重放，两者必须同一套坐标。
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 滤镜参数，取值与 CSS filter 语法一致。
 * 预览（CSS filter）与导出（ctx.filter）共用这一份参数，保证零色差。
 */
export interface Filters {
  brightness: number;
  contrast: number;
  saturate: number;
  /** 暖调用 */
  sepia: number;
  /** 冷调用，单位 deg */
  hueRotate: number;
}

export interface CanvasEditState {
  crop: CropRect | null;
  filters: Filters;
}

export interface CanvasState {
  active: CanvasImage | null;
  view: CanvasView;
  edit: CanvasEditState;
}

export type CanvasAction =
  | { type: "activate"; image: CanvasImage }
  | { type: "clear" }
  | { type: "setView"; view: CanvasView }
  | { type: "resetView" }
  | { type: "setCrop"; crop: CropRect }
  | { type: "clearCrop" }
  | { type: "setFilters"; filters: Partial<Filters> }
  | { type: "resetFilters" };

export const DEFAULT_VIEW: CanvasView = { scale: 1, x: 0, y: 0 };

export const DEFAULT_FILTERS: Filters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sepia: 0,
  hueRotate: 0,
};

/** 缩放区间 25%~400%（canvas-workspace spec）。 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

const DEFAULT_EDIT: CanvasEditState = { crop: null, filters: { ...DEFAULT_FILTERS } };

/** 判定「整幅裁剪」的容差：框选到几乎满幅时视觉与原图一致。 */
const FULL_FRAME_EPSILON = 0.001;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 把裁剪矩形钳进原图范围；退化为空的矩形视为未裁剪。 */
export function normalizeCrop(crop: CropRect): CropRect | null {
  const x = clamp01(crop.x);
  const y = clamp01(crop.y);
  const width = Math.min(clamp01(crop.width), 1 - x);
  const height = Math.min(clamp01(crop.height), 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function isFullFrame(crop: CropRect): boolean {
  return (
    Math.abs(crop.x) <= FULL_FRAME_EPSILON &&
    Math.abs(crop.y) <= FULL_FRAME_EPSILON &&
    Math.abs(crop.width - 1) <= FULL_FRAME_EPSILON &&
    Math.abs(crop.height - 1) <= FULL_FRAME_EPSILON
  );
}

export const initialCanvasState: CanvasState = {
  active: null,
  view: DEFAULT_VIEW,
  edit: DEFAULT_EDIT,
};

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function isDefaultFilters(filters: Filters): boolean {
  return (
    filters.brightness === DEFAULT_FILTERS.brightness &&
    filters.contrast === DEFAULT_FILTERS.contrast &&
    filters.saturate === DEFAULT_FILTERS.saturate &&
    filters.sepia === DEFAULT_FILTERS.sepia &&
    filters.hueRotate === DEFAULT_FILTERS.hueRotate
  );
}

/**
 * 导出入口可用性由编辑态推导：有实际裁剪或滤镜偏离默认值即为已修改。
 * 满幅裁剪与原图等价，不算修改（对应「无编辑不导出」）。
 */
export function isDirty(state: CanvasState): boolean {
  const { crop, filters } = state.edit;
  const cropped = crop !== null && !isFullFrame(crop);
  return cropped || !isDefaultFilters(filters);
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    // 以 url 判等：assetId 在服务端缺失时会是空串，多图无法区分。
    // 切图同时重置视图与编辑态，避免上一张图的裁剪/滤镜被带过去。
    case "activate":
      if (state.active?.url === action.image.url) return state;
      return { active: action.image, view: { ...DEFAULT_VIEW }, edit: { ...DEFAULT_EDIT } };
    case "clear":
      return initialCanvasState;
    case "setView":
      return { ...state, view: action.view };
    case "resetView":
      return { ...state, view: { ...DEFAULT_VIEW } };
    case "setCrop":
      return { ...state, edit: { ...state.edit, crop: normalizeCrop(action.crop) } };
    case "clearCrop":
      return { ...state, edit: { ...state.edit, crop: null } };
    case "setFilters":
      return {
        ...state,
        edit: { ...state.edit, filters: { ...state.edit.filters, ...action.filters } },
      };
    case "resetFilters":
      return { ...state, edit: { ...state.edit, filters: { ...DEFAULT_FILTERS } } };
  }
}
