"use client";

import { Button } from "@/components/ui/button";
import { LocaleToggle } from "@/components/locale-toggle";
import { ThemeToggle } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  CheckIcon,
  ClockIcon,
  PanelRightCloseIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface ChatPanelHeaderProps {
  /** 当前会话绑定 Agent 的头像 emoji 与名称。 */
  agentIcon?: string;
  agentName?: string;
  /** 当前会话标题（无会话时展示占位）。 */
  sessionTitle?: string;
  /** 是否可重命名（无会话时禁用）。 */
  canRename: boolean;
  onRename: (title: string) => void;
  /** 时钟下拉（受控）：提供 historyContent 时渲染，否则时钟按钮禁用。 */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  /** 下拉内容（会话列表 + 用户区，由页面组装）。 */
  historyContent?: ReactNode;
  onCollapse?: () => void;
}

/**
 * 任务化头部（spec/chat-streaming）：第一行 Agent 头像与名称，
 * 第二行会话标题 + AI 徽章 + 重命名铅笔 + 时钟入口 + 收起按钮。
 * 重命名复用行内编辑（Enter/失焦提交，Escape 取消），乐观更新由页面层负责。
 */
export function ChatPanelHeader({
  agentIcon,
  agentName,
  sessionTitle,
  canRename,
  onRename,
  historyOpen,
  onHistoryOpenChange,
  historyContent,
  onCollapse,
}: ChatPanelHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const title = sessionTitle || (canRename ? "未命名会话" : "未选择会话");

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const value = draft.trim();
    if (value) onRename(value);
    setEditing(false);
  };

  return (
    <header className="shrink-0 border-b border-border px-3 pb-2 pt-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs"
        >
          {agentIcon ?? "🤖"}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {agentName ?? "选择 Agent"}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {editing ? (
          <>
            <Input
              aria-label="会话标题"
              className="h-7 border-border bg-popover px-2 text-sm text-foreground"
              onBlur={commit}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") setEditing(false);
              }}
              ref={inputRef}
              value={draft}
            />
            <Button
              aria-label="确认重命名"
              className="size-6 shrink-0 text-foreground hover:bg-accent"
              onClick={commit}
              onMouseDown={(e) => e.preventDefault()}
              size="icon-sm"
              variant="ghost"
            >
              <CheckIcon />
            </Button>
            <Button
              aria-label="取消重命名"
              className="size-6 shrink-0 text-foreground hover:bg-accent"
              onClick={() => setEditing(false)}
              onMouseDown={(e) => e.preventDefault()}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={title}>
              {title}
            </span>
            <span className="shrink-0 rounded bg-violet-500/20 px-1 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">
              AI
            </span>
            <Button
              aria-label="重命名会话"
              className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground"
              disabled={!canRename}
              onClick={() => {
                setDraft(sessionTitle ?? "");
                setEditing(true);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <PencilIcon />
            </Button>
            {historyContent ? (
              <DropdownMenu
                onOpenChange={onHistoryOpenChange}
                open={historyOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="会话历史"
                    className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground"
                    size="icon-sm"
                    variant="ghost"
                    title="会话历史"
                  >
                    <ClockIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 p-0" sideOffset={8}>
                  {historyContent}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                aria-label="会话历史"
                className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground"
                disabled
                size="icon-sm"
                variant="ghost"
                title="会话历史"
              >
                <ClockIcon />
              </Button>
            )}
            <ThemeToggle className="size-6 text-muted-foreground hover:text-foreground" />
            <LocaleToggle className="size-6 text-muted-foreground hover:text-foreground" />
            <Button
              aria-label="收起聊天面板"
              className="size-6 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onCollapse}
              size="icon-sm"
              variant="ghost"
              title="收起"
            >
              <PanelRightCloseIcon />
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
