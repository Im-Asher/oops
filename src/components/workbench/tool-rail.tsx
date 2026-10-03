"use client";

import { Button } from "@/components/ui/button";
import {
  FolderOpenIcon,
  HandIcon,
  ImagePlusIcon,
  MessageSquareIcon,
  MousePointer2Icon,
} from "lucide-react";

/** 画布指针模式：select 点击选中图片，pan 拖拽平移画布。 */
export type CanvasMode = "select" | "pan";

interface ToolRailProps {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  onOpenSessions: () => void;
  chatVisible: boolean;
  onToggleChat: () => void;
  /** 参考图上传在创作闭环接入后才渲染，避免假入口。 */
  onUploadReference?: () => void;
}

const MODE_HINTS: Record<CanvasMode, string> = {
  select: "选择：点击图片选中",
  pan: "平移：拖动查看画布",
};

/** 56px 左侧工具条：会话抽屉、聊天显隐、选择/平移模式与参考图上传。 */
export function ToolRail({
  mode,
  onModeChange,
  onOpenSessions,
  chatVisible,
  onToggleChat,
  onUploadReference,
}: ToolRailProps) {
  return (
    <nav
      aria-label="工作台工具条"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-zinc-800/80 bg-[#141416] py-2"
    >
      <Button
        aria-label="打开会话抽屉"
        className="size-10 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
        onClick={onOpenSessions}
        size="icon"
        title="会话管理"
        variant="ghost"
      >
        <FolderOpenIcon />
      </Button>
      <Button
        aria-label={chatVisible ? "收起聊天面板" : "展开聊天面板"}
        aria-pressed={chatVisible}
        className="size-10 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
        onClick={onToggleChat}
        size="icon"
        title={chatVisible ? "收起聊天" : "展开聊天"}
        variant="ghost"
      >
        <MessageSquareIcon />
      </Button>
      <span aria-hidden className="my-1 h-px w-6 bg-zinc-800" />
      <Button
        aria-label={MODE_HINTS.select}
        aria-pressed={mode === "select"}
        className="size-10 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 data-[active=true]:bg-violet-500/20 data-[active=true]:text-violet-300"
        data-active={mode === "select"}
        onClick={() => onModeChange("select")}
        size="icon"
        title={MODE_HINTS.select}
        variant="ghost"
      >
        <MousePointer2Icon />
      </Button>
      <Button
        aria-label={MODE_HINTS.pan}
        aria-pressed={mode === "pan"}
        className="size-10 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 data-[active=true]:bg-violet-500/20 data-[active=true]:text-violet-300"
        data-active={mode === "pan"}
        onClick={() => onModeChange("pan")}
        size="icon"
        title={MODE_HINTS.pan}
        variant="ghost"
      >
        <HandIcon />
      </Button>
      {onUploadReference ? (
        <Button
          aria-label="上传参考图"
          className="size-10 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
          onClick={onUploadReference}
          size="icon"
          title="上传参考图"
          variant="ghost"
        >
          <ImagePlusIcon />
        </Button>
      ) : null}
    </nav>
  );
}
