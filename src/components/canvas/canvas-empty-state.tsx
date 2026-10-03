"use client";

import { ImageIcon } from "lucide-react";

/** 画布空态引导：会话尚无图片时居中展示（设计稿 §3.1）。 */
export function CanvasEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <ImageIcon className="size-12 text-zinc-700" strokeWidth={1.25} />
      <div className="space-y-1">
        <p className="font-medium text-sm text-zinc-50">画布还是空的</p>
        <p className="max-w-xs text-sm text-zinc-400">
          在聊天里描述你想要的图片，生成结果会直接出现在画布上
        </p>
      </div>
    </div>
  );
}
