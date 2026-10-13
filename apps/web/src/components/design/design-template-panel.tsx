"use client";

/**
 * 模版面板（spec design-editor「模版」）：内置模版以 JSON 实时缩小渲染
 * 缩略图（同一元素渲染组件按模版原始坐标铺放，外层 CSS scale 缩小，
 * 不使用独立图片资产）；点击 → 等比加载进画布（由页面层派发 loadTemplate）。
 */
import { useTranslations } from "next-intl";
import { DesignElementView } from "@/components/design/design-element-view";
import { DESIGN_TEMPLATES, type DesignTemplate } from "@/lib/design/templates";

/** 缩略渲染宽度（px）：高度按模版宽高比推导。 */
const THUMB_WIDTH = 176;

export function DesignTemplatePanel({ onSelect }: { onSelect: (template: DesignTemplate) => void }) {
  const t = useTranslations("design.templatePanel");
  return (
    <div>
      <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <div className="flex flex-col items-center gap-3">
        {DESIGN_TEMPLATES.map((template) => {
          const { doc } = template;
          return (
            <button
              aria-label={t(`names.${template.id}`)}
              className="block w-full overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-violet-400"
              data-testid={`design-template-${template.id}`}
              key={template.id}
              onClick={() => onSelect(template)}
              type="button"
            >
              <span
                className="relative block w-full overflow-hidden"
                style={{ height: (THUMB_WIDTH * doc.height) / doc.width }}
              >
                <span
                  className="absolute left-0 top-0 block"
                  style={{
                    background: doc.background,
                    height: doc.height,
                    transform: `scale(${THUMB_WIDTH / doc.width})`,
                    transformOrigin: "top left",
                    width: doc.width,
                  }}
                >
                  {doc.elements.map((element) => (
                    <DesignElementView element={element} key={element.id} />
                  ))}
                </span>
              </span>
              <span className="block px-2 py-1.5 text-xs text-muted-foreground">
                {t(`names.${template.id}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
