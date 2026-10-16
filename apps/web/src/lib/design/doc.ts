/**
 * 设计文档模型（DesignDoc）：空白画布、模版、进行中的设计稿共用同一 JSON 结构。
 * version 用于草稿回落校验，结构变更时递增版本并同步 parser。
 */

export const DESIGN_DOC_VERSION = 1;

export interface TextElementBackground {
  color: string;
  radius: number;
  paddingX: number;
  paddingY: number;
}

interface DesignElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 旋转角度（度，顺时针）。 */
  rotation: number;
  /** 0..1。 */
  opacity: number;
}

export interface TextElement extends DesignElementBase {
  type: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  /** 胶囊底色（花字关键属性），null = 无底色。 */
  background: TextElementBackground | null;
}

export interface ImageElement extends DesignElementBase {
  type: "image";
  src: string;
  fit: "cover" | "contain";
  radius: number;
}

export interface ShapeElement extends DesignElementBase {
  type: "shape";
  kind: "rect" | "ellipse";
  fill: string;
  /** rect 专属圆角（px），null = 直角。 */
  radius: number | null;
}

export type DesignElement = TextElement | ImageElement | ShapeElement;

export interface DesignDoc {
  version: number;
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
}

const TEXT_ALIGNS = new Set(["left", "center", "right"] as const);
const IMAGE_FITS = new Set(["cover", "contain"] as const);
const SHAPE_KINDS = new Set(["rect", "ellipse"] as const);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseElementBase(value: Record<string, unknown>): Pick<DesignElementBase, "id" | "x" | "y" | "w" | "h" | "rotation" | "opacity"> | null {
  if (!isNonEmptyString(value.id)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (!isFiniteNumber(value.w) || !isFiniteNumber(value.h) || value.w <= 0 || value.h <= 0) return null;
  if (!isFiniteNumber(value.rotation)) return null;
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) return null;
  return {
    id: value.id,
    x: value.x,
    y: value.y,
    w: value.w,
    h: value.h,
    rotation: value.rotation,
    opacity: value.opacity,
  };
}

function parseTextBackground(value: unknown): TextElementBackground | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return undefined;
  const bg = value as Record<string, unknown>;
  if (typeof bg.color !== "string") return undefined;
  if (!isFiniteNumber(bg.radius) || bg.radius < 0) return undefined;
  if (!isFiniteNumber(bg.paddingX) || bg.paddingX < 0) return undefined;
  if (!isFiniteNumber(bg.paddingY) || bg.paddingY < 0) return undefined;
  return { color: bg.color, radius: bg.radius, paddingX: bg.paddingX, paddingY: bg.paddingY };
}

function parseElement(value: unknown): DesignElement | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const base = parseElementBase(raw);
  if (!base) return null;

  switch (raw.type) {
    case "text": {
      if (typeof raw.content !== "string") return null;
      if (!isNonEmptyString(raw.fontFamily)) return null;
      if (!isFiniteNumber(raw.fontSize) || raw.fontSize <= 0) return null;
      if (!isFiniteNumber(raw.fontWeight) || raw.fontWeight <= 0) return null;
      if (typeof raw.color !== "string") return null;
      if (typeof raw.align !== "string" || !TEXT_ALIGNS.has(raw.align as TextElement["align"])) return null;
      if (!isFiniteNumber(raw.lineHeight) || raw.lineHeight <= 0) return null;
      const background = parseTextBackground(raw.background);
      if (background === undefined) return null;
      return {
        ...base,
        type: "text",
        content: raw.content,
        fontFamily: raw.fontFamily,
        fontSize: raw.fontSize,
        fontWeight: raw.fontWeight,
        color: raw.color,
        align: raw.align as TextElement["align"],
        lineHeight: raw.lineHeight,
        background,
      };
    }
    case "image": {
      if (!isNonEmptyString(raw.src)) return null;
      if (typeof raw.fit !== "string" || !IMAGE_FITS.has(raw.fit as ImageElement["fit"])) return null;
      if (!isFiniteNumber(raw.radius) || raw.radius < 0) return null;
      return { ...base, type: "image", src: raw.src, fit: raw.fit as ImageElement["fit"], radius: raw.radius };
    }
    case "shape": {
      if (typeof raw.kind !== "string" || !SHAPE_KINDS.has(raw.kind as ShapeElement["kind"])) return null;
      if (typeof raw.fill !== "string") return null;
      if (raw.radius !== null && (!isFiniteNumber(raw.radius) || raw.radius < 0)) return null;
      return {
        ...base,
        type: "shape",
        kind: raw.kind as ShapeElement["kind"],
        fill: raw.fill,
        radius: raw.radius as number | null,
      };
    }
    default:
      return null;
  }
}

/**
 * 解析未知数据为 DesignDoc：任一字段非法整体拒绝返回 null（草稿损坏当不存在，
 * 调用方回落空白画布），不抛错、不做局部修补。
 */
export function parseDesignDoc(value: unknown): DesignDoc | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== DESIGN_DOC_VERSION) return null;
  if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height) || raw.width <= 0 || raw.height <= 0) return null;
  if (typeof raw.background !== "string") return null;
  if (!Array.isArray(raw.elements)) return null;
  const elements: DesignElement[] = [];
  for (const item of raw.elements) {
    const element = parseElement(item);
    if (!element) return null;
    elements.push(element);
  }
  return {
    version: DESIGN_DOC_VERSION,
    width: raw.width,
    height: raw.height,
    background: raw.background,
    elements,
  };
}

/** 新建空白画布文档（白色背景）。 */
export function createEmptyDoc(width: number, height: number): DesignDoc {
  return { version: DESIGN_DOC_VERSION, width, height, background: "#ffffff", elements: [] };
}

/** 元素 id 生成：优先 crypto.randomUUID，SSR/旧环境退化为随机串。 */
export function newElementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `el-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
