/**
 * 模版目录：每个模版 = 完整 DesignDoc + baseWidth（加载时按画布宽度等比缩放）。
 * 模版缩略图由模版 JSON 实时缩小渲染，无需图片资产。
 */
import type { DesignDoc } from "@/lib/design/doc";
import { buildEcomMainTemplate } from "@/lib/design/templates/ecom-main";
import { buildXhsCoverTemplate } from "@/lib/design/templates/xhs-cover";

export interface DesignTemplate {
  /** 词典名键（design.templatePanel.names.<id>）与缩略 testid 共用；新模版需同步词典。 */
  id: "ecom-main" | "xhs-cover";
  baseWidth: number;
  doc: DesignDoc;
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  { id: "ecom-main", baseWidth: 800, doc: buildEcomMainTemplate() },
  { id: "xhs-cover", baseWidth: 1242, doc: buildXhsCoverTemplate() },
];

export function findTemplate(id: string): DesignTemplate | null {
  return DESIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}
