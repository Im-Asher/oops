/**
 * 画布视图几何：屏幕坐标与画布平面坐标的双向换算、锚点缩放、适应全部。
 * 纯函数，无 DOM 依赖；stage 只做事件采集与结果应用。
 */
import { clampScale, type CanvasView } from "@/lib/canvas/canvas-reducer";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 屏幕坐标（相对画布容器左上角）→ 画布平面坐标。
 * canvas = (screen - view.offset) / view.scale
 */
export function screenToCanvas(point: Point, view: CanvasView): Point {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
}

/** 画布平面坐标 → 屏幕坐标。 */
export function canvasToScreen(point: Point, view: CanvasView): Point {
  return {
    x: point.x * view.scale + view.x,
    y: point.y * view.scale + view.y,
  };
}

/**
 * 以 anchor（屏幕坐标）为不动点缩放到 nextScale：
 * 锚点指向的画布内容在缩放前后保持在指针下方。
 */
export function zoomAtPoint(
  view: CanvasView,
  nextScale: number,
  anchor: Point,
): CanvasView {
  const scale = clampScale(nextScale);
  const cx = (anchor.x - view.x) / view.scale;
  const cy = (anchor.y - view.y) / view.scale;
  return { scale, x: anchor.x - cx * scale, y: anchor.y - cy * scale };
}

/** 平移视图（屏幕 px 增量）。 */
export function panView(view: CanvasView, dx: number, dy: number): CanvasView {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * 视口内适应全部条目：取条目包围盒，缩放到适配并居中。
 * 无条目或包围盒退化时返回 null，调用方保持当前视图。
 */
export function fitView(
  items: ReadonlyArray<Rect>,
  viewport: { width: number; height: number },
  padding = 40,
): CanvasView | null {
  if (items.length === 0) return null;
  const minX = Math.min(...items.map((r) => r.x));
  const minY = Math.min(...items.map((r) => r.y));
  const maxX = Math.max(...items.map((r) => r.x + r.width));
  const maxY = Math.max(...items.map((r) => r.y + r.height));
  const boundsWidth = maxX - minX;
  const boundsHeight = maxY - minY;
  if (boundsWidth <= 0 || boundsHeight <= 0) return null;
  const scale = clampScale(
    Math.min(
      (viewport.width - padding * 2) / boundsWidth,
      (viewport.height - padding * 2) / boundsHeight,
    ),
  );
  return {
    scale,
    x: (viewport.width - boundsWidth * scale) / 2 - minX * scale,
    y: (viewport.height - boundsHeight * scale) / 2 - minY * scale,
  };
}

/** 条目矩形（画布平面坐标）是否完整落在视口内（定位提示判定）。 */
export function rectVisibleInViewport(
  rect: Rect,
  view: CanvasView,
  viewport: { width: number; height: number },
): boolean {
  const topLeft = canvasToScreen({ x: rect.x, y: rect.y }, view);
  const bottomRight = canvasToScreen(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    view,
  );
  return (
    topLeft.x >= 0 &&
    topLeft.y >= 0 &&
    bottomRight.x <= viewport.width &&
    bottomRight.y <= viewport.height
  );
}

/**
 * 以当前缩放把条目矩形平移到视口中心（摘要点击定位选中用）。
 * 只改平移不改缩放，避免定位时的视觉跳动。
 */
export function centerViewOn(
  rect: Rect,
  viewport: { width: number; height: number },
  scale: number,
): CanvasView {
  return {
    scale,
    x: (viewport.width - rect.width * scale) / 2 - rect.x * scale,
    y: (viewport.height - rect.height * scale) / 2 - rect.y * scale,
  };
}
