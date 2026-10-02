"use client";

import { MessageList } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CanvasImage } from "@/lib/canvas/canvas-reducer";
import type { AgentInfo, UIMessage } from "@/types/chat";
import { ArrowUpIcon, PanelLeftIcon, PanelRightCloseIcon } from "lucide-react";

interface ChatColumnProps {
  agents: AgentInfo[];
  /** 当前会话绑定的 Agent（新会话则为待创建的选择）。 */
  agentId: string;
  /** 切换 Agent：新会话仅更新选择；已有会话由页面重绑（PATCH，下一轮生效）。 */
  onAgentChange: (id: string) => void;
  /** 消息头像 emoji（会话当前绑定 Agent 的 icon）。 */
  agentIcon?: string;
  /** 会话标题（未命名时展示占位）。 */
  sessionTitle: string;
  activeUrl?: string | null;
  onActivateImage?: (image: CanvasImage) => void;
  messages: UIMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  /** 移动端：打开会话抽屉。 */
  onOpenSidebar: () => void;
  /** 折叠聊天列（折叠后画布占满）。 */
  onCollapse: () => void;
}

/**
 * 聊天列：会话头部（标题 + 折叠）+ 消息流 + 底部 composer（多行输入 + Agent 选择器 + 发送）。
 * 消息渲染由 MessageList 承载，本组件只负责容器与 composer，不持有会话状态。
 */
export function ChatColumn({
  agents,
  agentId,
  onAgentChange,
  agentIcon,
  sessionTitle,
  activeUrl,
  onActivateImage,
  messages,
  input,
  onInputChange,
  onSend,
  busy,
  onOpenSidebar,
  onCollapse,
}: ChatColumnProps) {
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col border-r border-zinc-800 bg-[#0A0A0A]">
      <header className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <Button
          aria-label="打开会话侧栏"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800 md:hidden"
          onClick={onOpenSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-zinc-50">
          {sessionTitle}
        </h1>
        <Button
          aria-label="折叠聊天列"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
          onClick={onCollapse}
          size="icon-sm"
          variant="ghost"
        >
          <PanelRightCloseIcon />
        </Button>
      </header>

      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col overflow-hidden">
        <MessageList
          activeUrl={activeUrl}
          agentIcon={agentIcon}
          messages={messages}
          onActivateImage={onActivateImage}
        />

        <div className="p-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 focus-within:border-zinc-600">
            <Textarea
              aria-label="消息输入"
              className="field-sizing-content max-h-40 min-h-10 resize-none border-0 bg-transparent p-1.5 text-sm text-zinc-50 shadow-none placeholder:text-zinc-500 focus-visible:ring-0"
              disabled={busy}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="描述你的图片需求…"
              rows={1}
              value={input}
            />
            <div className="flex items-center justify-between pt-1">
              <Select onValueChange={onAgentChange} value={agentId}>
                <SelectTrigger
                  aria-label="选择 Agent"
                  className="w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-zinc-300 shadow-none hover:bg-zinc-800"
                  size="sm"
                >
                  <SelectValue placeholder="选择 Agent" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 text-zinc-50">
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden>{a.icon}</span>
                        {a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                aria-label="发送"
                className="size-8 rounded-full"
                disabled={busy || !input.trim()}
                onClick={onSend}
                size="icon-sm"
              >
                {busy ? (
                  <span className="block size-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                ) : (
                  <ArrowUpIcon />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
