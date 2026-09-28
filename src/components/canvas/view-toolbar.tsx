"use client";

import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon } from "lucide-react";

interface ViewToolbarProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onActualSize: () => void;
}

/** 底部居中的查看工具条：缩放与适应，仅作用于视图（设计稿 §3.4）。 */
export function ViewToolbar({
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
}: ViewToolbarProps) {
  return (
    <div
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-1.5 py-1 backdrop-blur"
      // 阻止冒泡到画布：否则画布的 setPointerCapture 会吞掉按钮的 click。
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        aria-label="缩小"
        className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
        onClick={onZoomOut}
        size="icon-sm"
        variant="ghost"
      >
        <MinusIcon />
      </Button>
      <Button
        aria-label="重置为适应画布"
        className="min-h-11 min-w-0 px-2 text-xs text-zinc-50 hover:bg-zinc-800"
        onClick={onFit}
        size="sm"
        variant="ghost"
      >
        {Math.round(scale * 100)}%
      </Button>
      <Button
        aria-label="放大"
        className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
        onClick={onZoomIn}
        size="icon-sm"
        variant="ghost"
      >
        <PlusIcon />
      </Button>
      <span className="mx-1 h-5 w-px bg-zinc-800" />
      <Button
        aria-label="适应画布"
        className="min-h-11 px-2 text-xs text-zinc-50 hover:bg-zinc-800"
        onClick={onFit}
        size="sm"
        variant="ghost"
      >
        适应
      </Button>
      <Button
        aria-label="按原始像素 1:1 显示"
        className="min-h-11 px-2 text-xs text-zinc-50 hover:bg-zinc-800"
        onClick={onActualSize}
        size="sm"
        variant="ghost"
      >
        1:1
      </Button>
    </div>
  );
}
