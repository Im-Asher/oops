"use client";

import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon } from "lucide-react";

interface ViewToolbarProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 适应全部作品。 */
  onFit: () => void;
}

/** 底部居中的查看工具条：缩放与适应全部，仅作用于视角（设计稿 §3.4）。 */
export function ViewToolbar({ scale, onZoomIn, onZoomOut, onFit }: ViewToolbarProps) {
  return (
    <div
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-1.5 py-1 shadow-lg shadow-black/30"
      // 阻止冒泡到画布：否则画布的 setPointerCapture 会吞掉按钮的 click。
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        aria-label="缩小"
        className="min-h-11 min-w-11 text-foreground hover:bg-accent"
        onClick={onZoomOut}
        size="icon-sm"
        variant="ghost"
      >
        <MinusIcon />
      </Button>
      <Button
        aria-label="重置为适应画布"
        className="min-h-11 min-w-0 px-2 text-xs text-foreground hover:bg-accent"
        onClick={onFit}
        size="sm"
        variant="ghost"
      >
        {Math.round(scale * 100)}%
      </Button>
      <Button
        aria-label="放大"
        className="min-h-11 min-w-11 text-foreground hover:bg-accent"
        onClick={onZoomIn}
        size="icon-sm"
        variant="ghost"
      >
        <PlusIcon />
      </Button>
      <span className="mx-1 h-5 w-px bg-muted" />
      <Button
        aria-label="适应全部作品"
        className="min-h-11 px-2 text-xs text-foreground hover:bg-accent"
        onClick={onFit}
        size="sm"
        variant="ghost"
      >
        适应全部
      </Button>
    </div>
  );
}
