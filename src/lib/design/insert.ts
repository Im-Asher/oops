/**
 * 插入几何工具：预设片段落到画布的位置计算与模版等比缩放。
 * 纯函数；视图结构与 /canvas CanvasView 兼容（x/y/scale）。
 */
import { screenToCanvas } from "@/lib/canvas/coords";
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";
import type { DesignView } from "@/lib/design/design-reducer";

export interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 视口中心（屏幕坐标）→ 画布坐标，插入预设的默认落点。 */
export function viewportCenterToCanvas(
  viewport: { width: number; height: number },
  view: DesignView,
): Point {
  return screenToCanvas({ x: viewport.width / 2, y: viewport.height / 2 }, view);
}

/** 片段包围盒（忽略旋转：插入定位只需近似中心）。 */
export function fragmentBounds(elements: readonly DesignElement[]): Bounds | null {
  if (elements.length === 0) return null;
  const minX = Math.min(...elements.map((el) => el.x));
  const minY = Math.min(...elements.map((el) => el.y));
  const maxX = Math.max(...elements.map((el) => el.x + el.w));
  const maxY = Math.max(...elements.map((el) => el.y + el.h));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 平移片段使包围盒中心落在指定画布坐标（保持元素间相对位置）。 */
export function centerFragmentAt(
  elements: readonly DesignElement[],
  center: Point,
): DesignElement[] {
  const bounds = fragmentBounds(elements);
  if (!bounds) return [];
  const dx = center.x - (bounds.x + bounds.width / 2);
  const dy = center.y - (bounds.y + bounds.height / 2);
  return elements.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
}

function scaleTextElement(el: TextElement, k: number): TextElement {
  const background = el.background
    ? {
        ...el.background,
        radius: el.background.radius * k,
        paddingX: el.background.paddingX * k,
        paddingY: el.background.paddingY * k,
      }
    : null;
  return {
    ...el,
    x: el.x * k,
    y: el.y * k,
    w: el.w * k,
    h: el.h * k,
    fontSize: el.fontSize * k,
    background,
  };
}

function scaleImageElement(el: ImageElement, k: number): ImageElement {
  return { ...el, x: el.x * k, y: el.y * k, w: el.w * k, h: el.h * k, radius: el.radius * k };
}

function scaleShapeElement(el: ShapeElement, k: number): ShapeElement {
  return {
    ...el,
    x: el.x * k,
    y: el.y * k,
    w: el.w * k,
    h: el.h * k,
    radius: el.radius === null ? null : el.radius * k,
  };
}

/**
 * 模版元素按画布宽度等比缩放（几何 + 字号 + 胶囊内边距/圆角），
 * 文案与字体等语义属性保持不变。
 */
export function scaleTemplateElements(
  elements: readonly DesignElement[],
  baseWidth: number,
  canvasWidth: number,
): DesignElement[] {
  const k = canvasWidth / baseWidth;
  if (k === 1) return [...elements];
  return elements.map((el) => {
    switch (el.type) {
      case "text":
        return scaleTextElement(el, k);
      case "image":
        return scaleImageElement(el, k);
      case "shape":
        return scaleShapeElement(el, k);
    }
  });
}
