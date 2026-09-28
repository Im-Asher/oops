"use client";

import { MessageList } from "@/components/chat/message-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentInfo, SessionInfo, UIMessage } from "@/types/chat";
import { MessageSquareIcon, PanelLeftCloseIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FloatingChatPanelProps {
  agents: AgentInfo[];
  agentId: string;
  onAgentChange: (id: string) => void;
  sessions: SessionInfo[];
  currentId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  messages: UIMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
}

/**
 * 悬浮聊天面板：浮于画布之上，可折叠。
 * 仅替换简版布局的容器，消息流与会话逻辑由页面持有（见 chat-streaming delta spec）。
 */
export function FloatingChatPanel({
  agents,
  agentId,
  onAgentChange,
  sessions,
  currentId,
  onSelectSession,
  onNewChat,
  messages,
  input,
  onInputChange,
  onSend,
  busy,
}: FloatingChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const isFirstRender = useRef(true);

  // 折叠/展开会卸载切换按钮，需把焦点交还给新按钮，否则键盘用户被丢回文档开头。
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    toggleRef.current?.focus();
  }, [collapsed]);

  if (collapsed) {
    return (
      <Button
        aria-label="展开聊天面板"
        className="absolute left-4 top-4 z-30 min-h-11 min-w-11 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
        onClick={() => setCollapsed(false)}
        ref={toggleRef}
        size="icon"
        variant="secondary"
      >
        <MessageSquareIcon />
      </Button>
    );
  }

  return (
    <aside className="absolute inset-y-0 left-0 z-30 flex w-full flex-col bg-zinc-900/90 backdrop-blur md:inset-y-4 md:left-4 md:w-[380px] md:rounded-xl md:border md:border-zinc-800 md:shadow-2xl">
      <div className="flex items-center gap-1 border-b border-zinc-800 p-2">
        <Select onValueChange={onSelectSession} value={currentId ?? ""}>
          <SelectTrigger
            aria-label="会话"
            className="min-w-0 flex-1 border-zinc-800 bg-zinc-900 text-zinc-50"
            size="sm"
          >
            <SelectValue placeholder="选择会话" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 text-zinc-50">
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title || "未命名会话"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          aria-label="新建会话"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
          onClick={onNewChat}
          size="icon-sm"
          variant="ghost"
        >
          <PlusIcon />
        </Button>
        <Button
          aria-label="折叠聊天面板"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
          onClick={() => setCollapsed(true)}
          ref={toggleRef}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
        <span className="text-xs text-zinc-400">Agent</span>
        <Select onValueChange={onAgentChange} value={agentId}>
          <SelectTrigger
            aria-label="Agent"
            className="min-w-0 flex-1 border-zinc-800 bg-zinc-900 text-zinc-50"
            size="sm"
          >
            <SelectValue placeholder="选择 Agent" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 text-zinc-50">
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MessageList messages={messages} />

      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <Input
          className="border-zinc-800 bg-zinc-900 text-zinc-50 placeholder:text-zinc-500"
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) onSend();
          }}
          placeholder="描述你的图片需求…"
          value={input}
        />
        <Button className="shrink-0" disabled={busy} onClick={onSend}>
          {busy ? "生成中…" : "发送"}
        </Button>
      </div>
    </aside>
  );
}
