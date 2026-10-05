"use client";

import { ImagePlusIcon } from "lucide-react";

interface ResultChipProps {
  /** 对应 asset 已在画布选中。 */
  active: boolean;
  /** 会话内第几张图（1 起），用于生成可区分的无障碍名称。 */
  position: number;
  onFocus: () => void;
}

/**
 * 消息里的结果摘要 chip：图片本体由画布承载，聊天侧只留一条紧凑入口。
 * 点击把画布视角定位到对应条目并选中；选中态以紫色描边呈现。
 */
export function ResultChip({ active, position, onFocus }: ResultChipProps) {
  return (
    <button
      aria-label={active ? `第 ${position} 张图，已在画布选中` : `在画布中定位第 ${position} 张图`}
      aria-pressed={active}
      className={`mt-2 inline-flex h-8 cursor-pointer items-center gap-1.5 self-start rounded-full border bg-popover px-3 text-xs text-foreground/85 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-violet-400 text-violet-700 dark:text-violet-200" : "border-border hover:border-ring"
      }`}
      onClick={onFocus}
      title={active ? "已在画布选中" : "在画布中查看"}
      type="button"
    >
      <ImagePlusIcon aria-hidden className="size-3.5" />
      已生成图片 {position}
    </button>
  );
}
