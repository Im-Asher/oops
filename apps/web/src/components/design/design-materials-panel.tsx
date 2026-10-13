"use client";

/**
 * 素材面板（spec design-editor「素材」）：内置 SVG 素材目录网格，点击由页面层
 * 在视口中心插入对应图片元素（普通可编辑元素，可移动/缩放/删除）。
 */
import { useTranslations } from "next-intl";
import { DESIGN_MATERIALS, type DesignMaterial } from "@/lib/design/materials";

export function DesignMaterialsPanel({ onSelect }: { onSelect: (material: DesignMaterial) => void }) {
  const t = useTranslations("design.materialsPanel");
  return (
    <div>
      <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <div className="grid grid-cols-2 gap-2">
        {DESIGN_MATERIALS.map((material) => (
          <button
            aria-label={t(`names.${material.id}`)}
            className="flex items-center justify-center rounded-lg border border-border p-2 transition-colors hover:border-violet-400"
            data-testid={`design-material-${material.id}`}
            key={material.id}
            onClick={() => onSelect(material)}
            title={t(`names.${material.id}`)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 同源静态 SVG，无需 next/image 优化 */}
            <img
              alt={t(`names.${material.id}`)}
              className="max-h-16 max-w-full"
              draggable={false}
              src={material.src}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
