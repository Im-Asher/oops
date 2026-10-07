/**
 * 设计素材目录：public/design-materials/ 下内置 SVG（同源静态资源，
 * 草稿与导出无需 dataURL）。数量可少，机制与正式素材库一致。
 * 模块必须保持 client 安全（模版/素材面板引用），node 依赖只进测试。
 */
import { newElementId, type ImageElement } from "@/lib/design/doc";
export type DesignMaterialId =
  | "badge-starburst"
  | "badge-percent"
  | "tag-price"
  | "ribbon-banner"
  | "arrow-doodle"
  | "wave-deco"
  | "bubble-chat"
  | "crown"
  | "lightning"
  | "star";

export interface DesignMaterial {
  id: DesignMaterialId;
  /** 同源静态路径。 */
  src: string;
  /** viewBox 固有宽高（插入时按画布宽度比例缩放）。 */
  width: number;
  height: number;
}

export const MATERIALS_DIR = "design-materials";

export const DESIGN_MATERIALS: DesignMaterial[] = [
  { id: "badge-starburst", src: "/design-materials/badge-starburst.svg", width: 100, height: 100 },
  { id: "badge-percent", src: "/design-materials/badge-percent.svg", width: 100, height: 100 },
  { id: "tag-price", src: "/design-materials/tag-price.svg", width: 100, height: 100 },
  { id: "ribbon-banner", src: "/design-materials/ribbon-banner.svg", width: 200, height: 60 },
  { id: "arrow-doodle", src: "/design-materials/arrow-doodle.svg", width: 120, height: 100 },
  { id: "wave-deco", src: "/design-materials/wave-deco.svg", width: 200, height: 60 },
  { id: "bubble-chat", src: "/design-materials/bubble-chat.svg", width: 160, height: 120 },
  { id: "crown", src: "/design-materials/crown.svg", width: 120, height: 90 },
  { id: "lightning", src: "/design-materials/lightning.svg", width: 80, height: 120 },
  { id: "star", src: "/design-materials/star.svg", width: 100, height: 100 },
];

export function findMaterial(id: string): DesignMaterial | null {
  return DESIGN_MATERIALS.find((material) => material.id === id) ?? null;
}

/** 基准画布宽：素材固有尺寸按 800 宽画布设计，插入时随画布宽等比缩放。 */
const MATERIAL_BASE_WIDTH = 800;

/** 素材 → 单图片元素片段（x/y 置 0，由插入层负责视口中心对齐）。 */
export function materialElement(material: DesignMaterial, canvasWidth: number): ImageElement {
  const scale = canvasWidth / MATERIAL_BASE_WIDTH;
  return {
    id: newElementId(),
    type: "image",
    x: 0,
    y: 0,
    w: material.width * scale,
    h: material.height * scale,
    rotation: 0,
    opacity: 1,
    src: material.src,
    fit: "contain",
    radius: 0,
  };
}
