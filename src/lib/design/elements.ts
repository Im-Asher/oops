/**
 * 元素构造器：目录数据（花字/模版/文字预设）统一用这组工厂生成元素，
 * 自动生成 id 并填充默认样式，避免各目录散落重复字面量。
 */
import {
  newElementId,
  type DesignElement,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type TextElementBackground,
} from "@/lib/design/doc";
import { DEFAULT_FONT_FAMILY } from "@/lib/design/fonts";

export function textElement(
  opts: Partial<TextElement> &
    Pick<TextElement, "content" | "x" | "y" | "w" | "h" | "fontSize">,
): TextElement {
  return {
    id: newElementId(),
    type: "text",
    rotation: 0,
    opacity: 1,
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 400,
    color: "#1f2937",
    align: "center",
    lineHeight: 1.2,
    background: null as TextElementBackground | null,
    ...opts,
  };
}

export function shapeElement(
  opts: Partial<ShapeElement> & Pick<ShapeElement, "kind" | "fill" | "x" | "y" | "w" | "h">,
): ShapeElement {
  return { id: newElementId(), type: "shape", rotation: 0, opacity: 1, radius: null, ...opts };
}

export function imageElement(
  opts: Partial<ImageElement> & Pick<ImageElement, "src" | "x" | "y" | "w" | "h">,
): ImageElement {
  return { id: newElementId(), type: "image", rotation: 0, opacity: 1, fit: "contain", radius: 0, ...opts };
}
