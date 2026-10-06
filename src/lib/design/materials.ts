/**
 * 设计素材目录：public/design-materials/ 下内置 SVG（同源静态资源，
 * 草稿与导出无需 dataURL）。数量可少，机制与正式素材库一致。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface DesignMaterial {
  id: string;
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

/** 目录完整性：所有素材文件真实存在（测试守卫，防止悬空引用）。 */
export function allMaterialFilesExist(publicDir: string): boolean {
  return DESIGN_MATERIALS.every((material) =>
    existsSync(join(publicDir, material.src.replace(`/${MATERIALS_DIR}/`, `${MATERIALS_DIR}/`))),
  );
}
