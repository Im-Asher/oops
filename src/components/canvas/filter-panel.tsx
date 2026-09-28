"use client";

import { Button } from "@/components/ui/button";
import type { Filters } from "@/lib/canvas/canvas-reducer";
import { FILTER_PRESETS, supportsCanvasFilter } from "@/lib/canvas/filter-string";
import { XIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

interface FilterPanelProps {
  filters: Filters;
  onChange: (filters: Partial<Filters>) => void;
  onReset: () => void;
  onClose: () => void;
}

const SLIDERS = [
  { key: "brightness", label: "亮度", min: 0, max: 200 },
  { key: "contrast", label: "对比度", min: 0, max: 200 },
  { key: "saturate", label: "饱和度", min: 0, max: 200 },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<Filters, "brightness" | "contrast" | "saturate">;
  label: string;
  min: number;
  max: number;
}>;

/** 右侧浮层滤镜面板：滑杆 + 预设 + 重置（设计稿 §3.4）。 */
export function FilterPanel({ filters, onChange, onReset, onClose }: FilterPanelProps) {
  // 仅首帧检测一次即可：能力不会在会话中变化。
  const canvasFilterSupported = useMemo(() => supportsCanvasFilter(), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      aria-label="滤镜面板"
      className="absolute right-4 top-16 z-20 w-60 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-50">滤镜</span>
        <Button
          aria-label="关闭滤镜面板"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      {SLIDERS.map((slider) => (
        <label className="block" key={slider.key}>
          <span className="flex items-center justify-between text-xs text-zinc-300">
            <span>{slider.label}</span>
            <span className="tabular-nums text-zinc-400">{filters[slider.key]}%</span>
          </span>
          <input
            className="mt-1 w-full accent-zinc-50"
            max={slider.max}
            min={slider.min}
            onChange={(event) => onChange({ [slider.key]: Number(event.target.value) })}
            type="range"
            value={filters[slider.key]}
          />
        </label>
      ))}

      <div>
        <span className="text-xs text-zinc-300">预设</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {FILTER_PRESETS.map((preset) => (
            <Button
              className="min-h-11 px-2 text-xs text-zinc-50 hover:bg-zinc-800"
              key={preset.id}
              onClick={() => onChange(preset.filters)}
              size="sm"
              variant="ghost"
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {!canvasFilterSupported && (
        <p className="text-xs text-amber-300" role="status">
          当前浏览器不支持导出时套用滤镜（ctx.filter），预览正常；导出请改用 Chrome / Edge。
        </p>
      )}

      <Button className="w-full" onClick={onReset} size="sm" variant="secondary">
        重置
      </Button>
    </div>
  );
}
