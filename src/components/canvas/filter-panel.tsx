"use client";

import { Button } from "@/components/ui/button";
import type { Filters } from "@/lib/canvas/canvas-reducer";
import { FILTER_PRESETS, supportsCanvasFilter } from "@/lib/canvas/filter-string";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";

interface FilterPanelProps {
  filters: Filters;
  onChange: (filters: Partial<Filters>) => void;
  onReset: () => void;
  onClose: () => void;
}

const SLIDERS = [
  { key: "brightness", min: 0, max: 200 },
  { key: "contrast", min: 0, max: 200 },
  { key: "saturate", min: 0, max: 200 },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<Filters, "brightness" | "contrast" | "saturate">;
  min: number;
  max: number;
}>;

/** 右侧浮层滤镜面板：滑杆 + 预设 + 重置（设计稿 §3.4）。 */
export function FilterPanel({ filters, onChange, onReset, onClose }: FilterPanelProps) {
  const t = useTranslations("canvas.filterPanel");
  // 仅首帧检测一次即可：能力不会在会话中变化。
  const canvasFilterSupported = useMemo(() => supportsCanvasFilter(), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 滑杆与预设标签按稳定 key 查词典（SLIDERS/预设数据不携带 UI 文案）。
  const sliderLabels = {
    brightness: t("brightness"),
    contrast: t("contrast"),
    saturate: t("saturate"),
  };
  const presetLabels = {
    none: t("preset.none"),
    vivid: t("preset.vivid"),
    soft: t("preset.soft"),
    warm: t("preset.warm"),
    cool: t("preset.cool"),
    mono: t("preset.mono"),
  };

  return (
    <div
      aria-label={t("label")}
      className="absolute right-4 top-16 z-20 w-60 space-y-3 rounded-xl border border-border bg-popover p-3 shadow-lg shadow-black/30"
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{t("title")}</span>
        <Button
          aria-label={t("close")}
          className="min-h-11 min-w-11 text-foreground hover:bg-accent"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      {SLIDERS.map((slider) => (
        <label className="block" key={slider.key}>
          <span className="flex items-center justify-between text-xs text-foreground/80">
            <span>{sliderLabels[slider.key]}</span>
            <span className="tabular-nums text-muted-foreground">{filters[slider.key]}%</span>
          </span>
          <input
            className="mt-1 w-full accent-primary"
            max={slider.max}
            min={slider.min}
            onChange={(event) => onChange({ [slider.key]: Number(event.target.value) })}
            type="range"
            value={filters[slider.key]}
          />
        </label>
      ))}

      <div>
        <span className="text-xs text-foreground/80">{t("presets")}</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {FILTER_PRESETS.map((preset) => (
            <Button
              className="min-h-11 px-2 text-xs text-foreground hover:bg-accent"
              key={preset.id}
              onClick={() => onChange(preset.filters)}
              size="sm"
              variant="ghost"
            >
              {presetLabels[preset.id]}
            </Button>
          ))}
        </div>
      </div>

      {!canvasFilterSupported && (
        <p className="text-xs text-amber-300" role="status">
          {t("unsupportedHint")}
        </p>
      )}

      <Button className="w-full" onClick={onReset} size="sm" variant="secondary">
        {t("reset")}
      </Button>
    </div>
  );
}
