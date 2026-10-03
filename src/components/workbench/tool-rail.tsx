"use client";

import { Button } from "@/components/ui/button";
import { FolderOpenIcon, MessageSquareIcon } from "lucide-react";

interface ToolRailProps {
  onOpenSessions: () => void;
  chatVisible: boolean;
  onToggleChat: () => void;
}

/** 56px 左侧工具条：会话抽屉、聊天显隐与底部用户入口（见 user-auth「用户菜单与登出入口」）。 */
export function ToolRail({ onOpenSessions, chatVisible, onToggleChat }: ToolRailProps) {
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
    </nav>
  );
}
