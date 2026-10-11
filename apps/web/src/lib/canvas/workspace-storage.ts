import { clampScale, type CanvasView } from "@/lib/canvas/canvas-reducer";

/**
 * 会话级画布工作区持久化（本机 localStorage）：
 * positions 按 assetId（item id 每次派生重新生成，不能作跨刷新键）、
 * view、draft 与引用（assetId）。键含版本号，结构变更时换版本号即可。
 */
const PREFIX = "oops:workspace:v1:";

export interface WorkspaceSnapshot {
  positions: Record<string, { x: number; y: number }>;
  view: CanvasView;
  draft: string;
  referenceAssetId: string | null;
}

/** 可替换的存储接口：测试用内存实现，运行时用 localStorage。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** SSR/无 DOM 环境退化为 no-op 存储，避免调用方再判空。 */
function defaultStorage(): StorageLike {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const p = value as { x?: unknown; y?: unknown };
  return (
    typeof p.x === "number" &&
    Number.isFinite(p.x) &&
    typeof p.y === "number" &&
    Number.isFinite(p.y)
  );
}

/** 解析快照：缺失字段补默认，非法点过滤，非法整体返回 null（脏数据当不存在，不抛错）。 */
export function parseWorkspace(raw: string | null): WorkspaceSnapshot | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      positions?: unknown;
      view?: unknown;
      draft?: unknown;
      referenceAssetId?: unknown;
    };
    if (!data || typeof data !== "object") return null;
    const rawView = data.view as Partial<CanvasView> | undefined;
    if (
      !rawView ||
      typeof rawView.x !== "number" ||
      !Number.isFinite(rawView.x) ||
      typeof rawView.y !== "number" ||
      !Number.isFinite(rawView.y)
    ) {
      return null;
    }
    const positions: WorkspaceSnapshot["positions"] = {};
    if (data.positions && typeof data.positions === "object") {
      for (const [assetId, point] of Object.entries(data.positions)) {
        if (isPoint(point)) positions[assetId] = { x: point.x, y: point.y };
      }
    }
    return {
      positions,
      view: {
        x: rawView.x,
        y: rawView.y,
        scale: clampScale(Number(rawView.scale)),
      },
      draft: typeof data.draft === "string" ? data.draft : "",
      referenceAssetId: typeof data.referenceAssetId === "string" ? data.referenceAssetId : null,
    };
  } catch {
    return null;
  }
}

export function loadWorkspace(
  sessionId: string,
  storage: StorageLike = defaultStorage(),
): WorkspaceSnapshot | null {
  return parseWorkspace(storage.getItem(PREFIX + sessionId));
}

export function saveWorkspace(
  sessionId: string,
  snapshot: WorkspaceSnapshot,
  storage: StorageLike = defaultStorage(),
): void {
  storage.setItem(PREFIX + sessionId, JSON.stringify(snapshot));
}

export function clearWorkspace(sessionId: string, storage: StorageLike = defaultStorage()): void {
  storage.removeItem(PREFIX + sessionId);
}
