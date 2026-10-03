/**
 * 多作品画布状态模型。
 * 画布是统一平面：items 为会话全部作品（含生成占位卡），view 为视图变换，
 * edit（裁剪/滤镜）挂在每个条目上、作用于选中条目——切换选中不丢编辑。
 */
import { ITEM_WIDTH, placeNear, placeNew } from "@/lib/canvas/layout";

export interface CanvasView {
  scale: number;
  x: number;
  y: number;
}

export const DEFAULT_VIEW: CanvasView = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

// 条目尺寸常量与排布算法归口 layout 模块（ reducer 与 UI 共用，单一真相）。
export { ITEM_GAP, ITEM_WIDTH } from "@/lib/canvas/layout";

/** 归一化裁剪矩形（相对原图）。 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Filters {
  brightness: number;
  contrast: number;
  saturate: number;
  sepia: number;
  hueRotate: number;
}

export const DEFAULT_FILTERS: Filters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sepia: 0,
  hueRotate: 0,
};

export interface CanvasEdit {
  crop: CropRect | null;
  filters: Filters;
}

export type CanvasItemStatus = "image" | "generating" | "failed";

export interface CanvasItem {
  /** 画布实例 id（随机生成，仅前端）。 */
  id: string;
  /** 资产 id：布局持久化的稳定键。 */
  assetId: string;
  url: string;
  /** 画布平面坐标（px）。 */
  x: number;
  y: number;
  width: number;
  /** 高/宽比，图片加载后修正；占位卡默认 1。 */
  aspect: number;
  status: CanvasItemStatus;
  name?: string;
  prompt?: string;
  /** 修改血缘：该条目由哪个 asset 修改而来（版本邻近放置依据）。 */
  referenceAssetId?: string;
  errorMessage?: string;
  edit: CanvasEdit;
}

export interface CanvasState {
  items: CanvasItem[];
  view: CanvasView;
  selectedId: string | null;
}

export const initialCanvasState: CanvasState = {
  items: [],
  view: { ...DEFAULT_VIEW },
  selectedId: null,
};

export type CanvasAction =
  | {
      type: "addImageItems";
      /** 消息中的图片派生为画布条目；已有 assetId 的跳过（幂等）。 */
      images: Array<{ assetId: string; url: string; referenceAssetId?: string; name?: string }>;
    }
  | { type: "addPlaceholder"; id: string; referenceAssetId?: string; prompt?: string }
  | { type: "patchItem"; id: string; patch: Partial<Omit<CanvasItem, "id" | "edit">> }
  | { type: "removeItem"; id: string }
  | { type: "moveItem"; id: string; x: number; y: number }
  | { type: "select"; id: string | null }
  | { type: "setView"; view: CanvasView }
  | { type: "resetView" }
  | { type: "setCrop"; id: string; crop: CropRect | null }
  | { type: "setFilters"; id: string; filters: Partial<Filters> }
  | { type: "resetFilters"; id: string }
  | { type: "clear" };

function createItemId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function defaultEdit(): CanvasEdit {
  return { crop: null, filters: { ...DEFAULT_FILTERS } };
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function selectedItem(state: CanvasState): CanvasItem | null {
  return state.items.find((item) => item.id === state.selectedId) ?? null;
}

/** 裁剪是否等效于未裁剪（满幅 = 无裁剪）。 */
function cropEqualsFull(crop: CropRect | null): boolean {
  if (!crop) return true;
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

export function isDefaultFilters(filters: Filters): boolean {
  return filtersEqual(filters, DEFAULT_FILTERS);
}

export function filtersEqual(a: Filters, b: Filters): boolean {
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturate === b.saturate &&
    a.sepia === b.sepia &&
    a.hueRotate === b.hueRotate
  );
}

/** 单个条目是否有真实编辑（导出入口依据）。 */
export function isItemDirty(item: CanvasItem): boolean {
  return !cropEqualsFull(item.edit.crop) || !filtersEqual(item.edit.filters, DEFAULT_FILTERS);
}

/** 选中条目是否有真实编辑。 */
export function isDirty(state: CanvasState): boolean {
  const selected = selectedItem(state);
  return selected ? isItemDirty(selected) : false;
}

/** 归一化裁剪矩形：钳制到原图范围内，退化/非法输入返回 null 或安全值。 */
export function normalizeCrop(rect: CropRect): CropRect | null {
  const safe = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  let x = safe(rect.x, 0);
  let y = safe(rect.y, 0);
  let width = safe(rect.width, 0);
  let height = safe(rect.height, 0);
  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  width = Math.min(Math.max(width, 0), 1 - x);
  height = Math.min(Math.max(height, 0), 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "addImageItems": {
      let items = state.items;
      let changed = false;
      for (const image of action.images) {
        if (items.some((item) => item.assetId === image.assetId)) continue;
        // 带血缘的修改结果放置在源图附近；其余按货架流找空位
        const source = image.referenceAssetId
          ? items.find((item) => item.assetId === image.referenceAssetId)
          : undefined;
        const slot = source ? placeNear(source, items, 1) : placeNew(items, 1);
        items = [
          ...items,
          {
            id: createItemId(),
            assetId: image.assetId,
            url: image.url,
            x: slot.x,
            y: slot.y,
            width: ITEM_WIDTH,
            aspect: 1,
            status: "image",
            name: image.name,
            referenceAssetId: image.referenceAssetId,
            edit: defaultEdit(),
          },
        ];
        changed = true;
      }
      return changed ? { ...state, items } : state;
    }
    case "addPlaceholder": {
      const source = action.referenceAssetId
        ? state.items.find((item) => item.assetId === action.referenceAssetId)
        : undefined;
      const slot = source ? placeNear(source, state.items, 1) : placeNew(state.items, 1);
      const item: CanvasItem = {
        id: action.id,
        assetId: "",
        url: "",
        x: slot.x,
        y: slot.y,
        width: ITEM_WIDTH,
        aspect: 1,
        status: "generating",
        prompt: action.prompt,
        referenceAssetId: action.referenceAssetId,
        edit: defaultEdit(),
      };
      return { ...state, items: [...state.items, item] };
    }
    case "patchItem": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, ...action.patch } : item,
        ),
      };
    }
    case "removeItem": {
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }
    case "moveItem": {
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, x: action.x, y: action.y } : item,
        ),
      };
    }
    case "select":
      return { ...state, selectedId: action.id };
    case "setView":
      return {
        ...state,
        view: {
          scale: clampScale(action.view.scale),
          x: Number.isFinite(action.view.x) ? action.view.x : 0,
          y: Number.isFinite(action.view.y) ? action.view.y : 0,
        },
      };
    case "resetView":
      return { ...state, view: { ...DEFAULT_VIEW } };
    case "setCrop": {
      const crop = action.crop ? normalizeCrop(action.crop) : null;
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, edit: { ...item.edit, crop } } : item,
        ),
      };
    }
    case "setFilters":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? { ...item, edit: { ...item.edit, filters: { ...item.edit.filters, ...action.filters } } }
            : item,
        ),
      };
    case "resetFilters":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? { ...item, edit: { ...item.edit, filters: { ...DEFAULT_FILTERS } } }
            : item,
        ),
      };
    case "clear":
      return initialCanvasState;
    default:
      return state;
  }
}
