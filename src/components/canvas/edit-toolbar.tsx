"use client";

import { Button } from "@/components/ui/button";
import {
  CropIcon,
  DownloadIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

interface EditToolbarProps {
  busy: boolean;
  cropping: boolean;
  dirty: boolean;
  exporting: boolean;
  filtersOpen: boolean;
  onExport: () => void;
  onResetEdits: () => void;
  onToggleCrop: () => void;
  onToggleFilters: () => void;
}

/** 右上编辑工具条（设计稿 §3.4）：裁剪、滤镜、导出、重置。 */
export function EditToolbar({
  busy,
  cropping,
  dirty,
  exporting,
  filtersOpen,
  onExport,
  onResetEdits,
  onToggleCrop,
  onToggleFilters,
}: EditToolbarProps) {
  return (
    <div
      className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-1.5 py-1 shadow-lg shadow-black/30"
      // 同 ViewToolbar：阻止冒泡到画布，否则指针捕获会吞掉 click。
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        aria-label="裁剪模式"
        aria-pressed={cropping}
        className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
        onClick={onToggleCrop}
        size="icon-sm"
        variant={cropping ? "secondary" : "ghost"}
      >
        <CropIcon />
      </Button>
      <Button
        aria-label="滤镜面板"
        aria-pressed={filtersOpen}
        className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
        onClick={onToggleFilters}
        size="icon-sm"
        variant={filtersOpen ? "secondary" : "ghost"}
      >
        <SlidersHorizontalIcon />
      </Button>
      {!cropping ? (
        <>
          <Button
            aria-label="重置编辑"
            className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
            disabled={!dirty}
            onClick={onResetEdits}
            size="icon-sm"
            variant="ghost"
          >
            <RotateCcwIcon />
          </Button>
          <Button
            aria-label="导出为图片"
            className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
            disabled={!dirty || exporting || busy}
            onClick={onExport}
            size="icon-sm"
            variant="ghost"
          >
            <DownloadIcon />
          </Button>
        </>
      ) : null}
    </div>
  );
}
