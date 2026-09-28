"use client";

import type { ReactNode } from "react";

/**
 * 全屏画布容器：占满视口、深色中性底，承载激活图与画布浮层。
 * 后续任务在此内部追加激活图、裁剪蒙层、工具条等子元素。
 */
export function CanvasStage({ children }: { children?: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
      {children}
    </div>
  );
}
