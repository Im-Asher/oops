"use client";

import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/** 画布空态引导：会话尚无图片时在画布视口正中展示；pointer-events 穿透以便空白处仍可平移画布。 */
export function CanvasEmptyState() {
  const t = useTranslations("canvas.emptyState");

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <ImageIcon className="size-12 text-muted-foreground/40" strokeWidth={1.25} />
        <div className="space-y-1">
          <p className="font-medium text-sm text-foreground">{t("title")}</p>
          <p className="max-w-xs text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>
    </div>
  );
}
