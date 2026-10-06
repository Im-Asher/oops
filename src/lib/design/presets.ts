/**
 * 尺寸预设目录（客户端静态数据）与「最近使用」本地存储。
 * 预设名称为词典 key（design.presets.<id>.name），由组件按 locale 解析。
 */
import type { StorageLike } from "@/lib/canvas/workspace-storage";

export interface DesignPreset {
  id: string;
  width: number;
  height: number;
}

export interface DesignPresetGroup {
  id: "common" | "ecom" | "social";
  presets: DesignPreset[];
}

export const DESIGN_PRESET_GROUPS: DesignPresetGroup[] = [
  {
    id: "common",
    presets: [
      { id: "poster-mobile", width: 1242, height: 2208 },
      { id: "poster-square", width: 1080, height: 1080 },
      { id: "poster-landscape", width: 1920, height: 1080 },
      { id: "video-vertical", width: 1080, height: 1920 },
    ],
  },
  {
    id: "ecom",
    presets: [
      { id: "main-image", width: 800, height: 800 },
      { id: "detail-page", width: 750, height: 1600 },
      { id: "livestream-cover", width: 1080, height: 1920 },
      { id: "shop-banner", width: 1920, height: 600 },
    ],
  },
  {
    id: "social",
    presets: [
      { id: "xhs-cover", width: 1242, height: 1656 },
      { id: "xhs-image", width: 1080, height: 1440 },
      { id: "moments", width: 1080, height: 1920 },
      { id: "weibo", width: 1080, height: 810 },
    ],
  },
];

export interface DesignSize {
  width: number;
  height: number;
}

const RECENT_KEY = "oops:design:recent-sizes:v1";
const RECENT_LIMIT = 8;

function defaultStorage(): StorageLike {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}

function parseSizes(raw: string | null): DesignSize[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is DesignSize =>
        !!item &&
        typeof item === "object" &&
        typeof (item as DesignSize).width === "number" &&
        Number.isFinite((item as DesignSize).width) &&
        typeof (item as DesignSize).height === "number" &&
        Number.isFinite((item as DesignSize).height) &&
        (item as DesignSize).width > 0 &&
        (item as DesignSize).height > 0,
    );
  } catch {
    return [];
  }
}

/** 读取最近使用尺寸（最近在前，上限 8，损坏数据视为空）。 */
export function loadRecentSizes(storage: StorageLike = defaultStorage()): DesignSize[] {
  return parseSizes(storage.getItem(RECENT_KEY)).slice(0, RECENT_LIMIT);
}

/**
 * 记录一次使用的尺寸（非自定义创建时调用）：
 * 同尺寸去重置顶，超出上限丢弃最旧，返回新列表。
 */
export function recordRecentSize(
  size: DesignSize,
  storage: StorageLike = defaultStorage(),
): DesignSize[] {
  const rest = loadRecentSizes(storage).filter(
    (item) => item.width !== size.width || item.height !== size.height,
  );
  const next = [size, ...rest].slice(0, RECENT_LIMIT);
  storage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
