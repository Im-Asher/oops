"use client";

import { Composer, type ComposerReference } from "@/components/chat/floating-composer";
import { MessageList } from "@/components/chat/message-list";
import type { CanvasImage } from "@/lib/canvas/canvas-reducer";
import type { AgentInfo, UIMessage } from "@/types/chat";

interface ChatPanelProps {
  agents: AgentInfo[];
  /** 当前会话绑定的 Agent（新会话则为待创建的选择）。 */
  agentId: string;
  /** 切换 Agent：新会话仅更新选择；已有会话由页面重绑（PATCH，下一轮生效）。 */
  onAgentChange: (id: string) => void;
  /** 消息头像 emoji（会话当前绑定 Agent 的 icon）。 */
  agentIcon?: string;
  hasSession: boolean;
  messages: UIMessage[];
  /** 过渡期：单激活图上屏联动（多作品画布落地后移除）。 */
  activeUrl?: string | null;
  onActivateImage?: (image: CanvasImage) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  reference?: ComposerReference | null;
  onRemoveReference?: () => void;
}

/**
 * 聊天面板：停靠左侧 340px，展示需求、回复、任务状态与结果摘要。
 * 收起后输入框由页面以悬浮 Composer 呈现于画布底部（同一份草稿与引用）。
 */
export function ChatPanel({
  agents,
  agentId,
  onAgentChange,
  agentIcon,
  hasSession,
  messages,
  activeUrl,
  onActivateImage,
  input,
  onInputChange,
  onSend,
  busy,
  reference,
  onRemoveReference,
}: ChatPanelProps) {
  return (
    <section aria-label="聊天面板" className="flex h-full w-full min-w-0 flex-col bg-[#101012]">
      <MessageList
        activeUrl={activeUrl}
        agentIcon={agentIcon}
        messages={messages}
        onActivateImage={onActivateImage}
      />
      <div className="p-3">
        <Composer
          agentId={agentId}
          agents={agents}
          busy={busy}
          hasSession={hasSession}
          onChange={onInputChange}
          onAgentChange={onAgentChange}
          onSend={onSend}
          reference={reference}
          onRemoveReference={onRemoveReference}
          value={input}
        />
      </div>
    </section>
  );
}
