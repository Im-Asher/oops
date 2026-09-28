import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  type Filters,
} from "@/lib/canvas/canvas-reducer";

/**
 * 滤镜参数 → CSS filter 串。
 * 预览把它赋给图片元素的 CSS filter，导出把它赋给离屏 canvas 的 ctx.filter，
 * 两边共用同一串，因此预览与导出视觉一致。
 */
export function filtersToCss(filters: Filters): string {
  const parts = [
    `brightness(${filters.brightness}%)`,
    `contrast(${filters.contrast}%)`,
    `saturate(${filters.saturate}%)`,
  ];
  if (filters.sepia > 0) parts.push(`sepia(${filters.sepia}%)`);
  if (filters.hueRotate !== 0) parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  return parts.join(" ");
}

/**
 * 默认参数不产生滤镜（返回 undefined 以便直接赋给 filter 属性）。
 * 复用 reducer 的 isDefaultFilters，避免与 dirty 判定出现两份真相。
 */
export function filtersToCssOrNone(filters: Filters): string | undefined {
  return isDefaultFilters(filters) ? undefined : filtersToCss(filters);
}

export interface FilterPreset {
  id: string;
  label: string;
  filters: Filters;
}

/** 设计稿 §3.4 的六组预设。 */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: "none", label: "原图", filters: { ...DEFAULT_FILTERS } },
  {
    id: "vivid",
    label: "鲜明",
    filters: { brightness: 105, contrast: 115, saturate: 135, sepia: 0, hueRotate: 0 },
  },
  {
    id: "soft",
    label: "柔和",
    filters: { brightness: 110, contrast: 90, saturate: 85, sepia: 0, hueRotate: 0 },
  },
  {
    id: "warm",
    label: "暖调",
    filters: { brightness: 105, contrast: 100, saturate: 120, sepia: 15, hueRotate: 0 },
  },
  {
    id: "cool",
    label: "冷调",
    filters: { brightness: 100, contrast: 105, saturate: 95, sepia: 0, hueRotate: -8 },
  },
  {
    id: "mono",
    label: "黑白",
    filters: { brightness: 100, contrast: 110, saturate: 0, sepia: 0, hueRotate: 0 },
  },
];

/**
 * 检测 ctx.filter 支持（Safari 旧版不支持）。
 * 不支持时预览仍可用 CSS filter，但导出无法套用滤镜，需要提示降级。
 */
export function supportsCanvasFilter(): boolean {
  if (typeof document === "undefined") return false;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  // 必须先判断属性存在：不支持的浏览器上给 context 赋值只会挂上普通属性并原样读回，
  // 那样检测恒为 true，Safari 下会静默丢掉导出滤镜。
  if (!("filter" in context)) return false;
  try {
    context.filter = "brightness(110%)";
    return context.filter === "brightness(110%)";
  } catch {
    return false;
  }
}
