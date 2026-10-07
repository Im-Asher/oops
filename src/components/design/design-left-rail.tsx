"use client";

/**
 * 左侧功能栏 rail（spec design-editor「设计页布局」）：
 * 模版/文字/素材三个面板入口，点击切换展开（再点当前项收起）。
 * 模版/文字已接入；素材入口先行禁用，由 5.4 启用。
 */
import { LayoutTemplateIcon, ShapesIcon, TypeIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export type DesignRailPanel = "templates" | "text" | "materials";

const ENTRIES: { id: DesignRailPanel; icon: typeof LayoutTemplateIcon; disabled: boolean }[] = [
  { disabled: false, icon: LayoutTemplateIcon, id: "templates" },
  { disabled: false, icon: TypeIcon, id: "text" },
  { disabled: true, icon: ShapesIcon, id: "materials" },
];

export function DesignLeftRail({
  active,
  onSelect,
}: {
  active: DesignRailPanel | null;
  onSelect: (panel: DesignRailPanel | null) => void;
}) {
  const t = useTranslations("design.rail");
  return (
    <nav aria-label={t("label")} className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-3">
      {ENTRIES.map(({ disabled, icon: Icon, id }) => (
        <button
          aria-label={t(id)}
          className={`rounded-lg p-2.5 ${
            active === id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          } disabled:pointer-events-none disabled:opacity-40`}
          data-testid={`design-rail-${id}`}
          disabled={disabled}
          key={id}
          onClick={() => onSelect(active === id ? null : id)}
          title={t(id)}
          type="button"
        >
          <Icon className="size-5" />
        </button>
      ))}
    </nav>
  );
}
