"use client";

import { Button } from "@/components/ui/button";
import { CropIcon } from "lucide-react";

interface EditToolbarProps {
  cropping: boolean;
  onToggleCrop: () => void;
}

/** 右上编辑工具条（设计稿 §3.4）。后续任务追加滤镜、导出、重置。 */
export function EditToolbar({ cropping, onToggleCrop }: EditToolbarProps) {
  return (
    <div
      className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 px-1.5 py-1 backdrop-blur"
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
    </div>
  );
}
