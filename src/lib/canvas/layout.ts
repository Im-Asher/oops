/**
 * 画布自动排布：新结果不覆盖既有作品；带引用的修改在源图附近形成版本列。
 * 纯函数 + 确定性（同输入同输出），便于单测与持久化恢复叠加。
 */
import type { CanvasItem } from "@/lib/canvas/canvas-reducer";
import type { Rect } from "@/lib/canvas/coords";

/** 条目统一显示宽度与间距（画布平面 px）；高度 = width * aspect。 */
export const ITEM_WIDTH = 320;
export const ITEM_GAP = 24;

/** 视口锚点（画布世界坐标）：无引用新结果围绕它外扩找空闲位。 */
export interface PlaceAnchor {
  x: number;
  y: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** 条目的画布平面矩形。 */
export function itemRect(item: CanvasItem): Rect {
  return { x: item.x, y: item.y, width: item.width, height: item.width * item.aspect };
}

/**
 * 第一个与既有条目都不相交的槽位。
 * 无锚点：列优先网格从世界原点扫描（先向下、再向右）。
 * 有锚点：中心对齐锚点的槽优先，随后按 Chebyshev 环外扩
 * （环内按 (row, col) 字典序固定排序），取首个不相交槽；200 环无空位退回原点槽。
 * 注：aspect 较大（高 > 步长）时纵向相邻环格互相重叠，可能直接跳到更外环，行为仍确定。
 */
export function placeNew(
  items: ReadonlyArray<CanvasItem>,
  aspect = 1,
  excludeId?: string,
  anchor?: PlaceAnchor,
): Rect {
  const height = ITEM_WIDTH * aspect;
  const occupied = items
    .filter((item) => item.id !== excludeId)
    .map(itemRect);
  const trySlot = (x: number, y: number): Rect | null => {
    const slot: Rect = { x, y, width: ITEM_WIDTH, height };
    return occupied.some((rect) => intersects(slot, rect)) ? null : slot;
  };
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    for (let col = 0; col < 200; col++) {
      for (let row = 0; row < 200; row++) {
        const slot = trySlot(col * (ITEM_WIDTH + ITEM_GAP), row * (ITEM_WIDTH + ITEM_GAP));
        if (slot) return slot;
      }
    }
    return { x: 0, y: 0, width: ITEM_WIDTH, height };
  }
  const step = ITEM_WIDTH + ITEM_GAP;
  const slotX = anchor.x - ITEM_WIDTH / 2;
  const slotY = anchor.y - height / 2;
  const center = trySlot(slotX, slotY);
  if (center) return center;
  for (let ring = 1; ring <= 200; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(col), Math.abs(row)) !== ring) continue;
        const slot = trySlot(slotX + col * step, slotY + row * step);
        if (slot) return slot;
      }
    }
  }
  return { x: 0, y: 0, width: ITEM_WIDTH, height };
}

/**
 * 版本邻近放置：新版本出现在源图右侧；同一源图的多个版本向下依次排列。
 * 与既有条目（含其他版本）都不相交，原图位置不变。
 */
export function placeNear(
  source: CanvasItem,
  items: ReadonlyArray<CanvasItem>,
  aspect = 1,
): Rect {
  const height = ITEM_WIDTH * aspect;
  const occupied = items.map(itemRect);
  const versionCount = items.filter(
    (item) => item.referenceAssetId === source.assetId,
  ).length;
  for (let k = 0; k < 200; k++) {
    const slot: Rect = {
      x: source.x + source.width + ITEM_GAP,
      y: source.y + (versionCount + k) * (height + ITEM_GAP),
      width: ITEM_WIDTH,
      height,
    };
    if (!occupied.some((rect) => intersects(slot, rect))) return slot;
  }
  return placeNew(items, aspect);
}
