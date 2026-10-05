"use client";

import { Button } from "@/components/ui/button";
import { CropIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";

interface EditToolbarProps {
  cropping: boolean;
  dirty: boolean;
  filtersOpen: boolean;
  onResetEdits: () => void;
  onToggleCrop: () => void;
  onToggleFilters: () => void;
}

/** 右上编辑工具条（设计稿 §3.4）：裁剪、滤镜、重置（导出唯一入口在画布右上悬浮区）。 */
export function EditToolbar({
  cropping,
  dirty,
  filtersOpen,
  onResetEdits,
  onToggleCrop,
  onToggleFilters,
}: EditToolbarProps) {
  return (
    <div
      className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-border bg-popover px-1.5 py-1 shadow-lg shadow-black/30"
      // 同 ViewToolbar：阻止冒泡到画布，否则指针捕获会吞掉 click。
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        aria-label="裁剪模式"
        aria-pressed={cropping}
        className="min-h-11 min-w-11 text-foreground hover:bg-accent"
        onClick={onToggleCrop}
        size="icon-sm"
        variant={cropping ? "secondary" : "ghost"}
      >
        <CropIcon />
      </Button>
      <Button
        aria-label="滤镜面板"
        aria-pressed={filtersOpen}
        className="min-h-11 min-w-11 text-foreground hover:bg-accent"
        onClick={onToggleFilters}
        size="icon-sm"
        variant={filtersOpen ? "secondary" : "ghost"}
      >
        <SlidersHorizontalIcon />
      </Button>
      {!cropping ? (
        <Button
          aria-label="重置编辑"
          className="min-h-11 min-w-11 text-foreground hover:bg-accent"
          disabled={!dirty}
          onClick={onResetEdits}
          size="icon-sm"
          variant="ghost"
        >
          <RotateCcwIcon />
        </Button>
      ) : null}
    </div>
  );
}
