"use client";

import { ChatPanelHeader } from "@/components/chat/chat-panel-header";
import { Composer, type ComposerReference } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import type { AgentInfo, UIMessage } from "@/types/chat";
import type { ReactNode } from "react";

interface ChatPanelProps {
  agents: AgentInfo[];
  /** 当前会话绑定的 Agent（新会话则为待创建的选择）。 */
  agentId: string;
  /** 切换 Agent：新会话仅更新选择；已有会话由页面重绑（PATCH，下一轮生效）。 */
  onAgentChange: (id: string) => void;
  /** 消息与头部头像 emoji（会话当前绑定 Agent 的 icon）。 */
  agentIcon?: string;
  /** 头部展示的 Agent 名称。 */
  agentName?: string;
  /** 当前会话标题（头部展示与重命名初始值）。 */
  sessionTitle?: string;
  hasSession: boolean;
  /** 重命名当前会话（乐观更新与失败回滚由页面层负责）。 */
  onRename?: (title: string) => void;
  /** 头部时钟下拉（受控）：内容由页面组装（会话列表 + 用户区）。 */
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  historyContent?: ReactNode;
  /** 收起聊天面板（画布左上出现重开入口）。 */
  onCollapse?: () => void;
  messages: UIMessage[];
  /** 画布当前选中条目的 assetId（过渡联动：聊天缩略图高亮）。 */
  selectedAssetId?: string | null;
  onSelectAsset?: (assetId: string) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  /** busy 时停止按钮回调（无则维持禁用转圈）。 */
  onStop?: () => void;
  busy: boolean;
  reference?: ComposerReference | null;
  onRemoveReference?: () => void;
  /** 外部聚焦信号（透传停靠形态输入框）。 */
  focusSignal?: number;
  /** 附件上传参考图入口（透传停靠形态输入框）。 */
  onAttach?: () => void;
}

/**
 * 聊天面板：悬浮卡片（md+ 画布左上、<md 全屏），展示需求、回复、任务状态与结果摘要。
 * 输入框仅存在此面板内；收起面板后无任何输入框（草稿由页面状态保留）。
 */
export function ChatPanel({
  agents,
  agentId,
  onAgentChange,
  agentIcon,
  agentName,
  sessionTitle,
  hasSession,
  onRename,
  historyOpen,
  onHistoryOpenChange,
  historyContent,
  onCollapse,
  messages,
  selectedAssetId,
  onSelectAsset,
  input,
  onInputChange,
  onSend,
  onStop,
  busy,
  reference,
  onRemoveReference,
  focusSignal,
  onAttach,
}: ChatPanelProps) {
  return (
    <section aria-label="聊天面板" className="flex h-full w-full min-w-0 flex-col bg-card">
      <ChatPanelHeader
        agentIcon={agentIcon}
        agentName={agentName}
        canRename={hasSession && !!onRename}
        historyContent={historyContent}
        historyOpen={historyOpen}
        onCollapse={onCollapse}
        onHistoryOpenChange={onHistoryOpenChange}
        onRename={(title) => onRename?.(title)}
        sessionTitle={sessionTitle}
      />
      <MessageList
        agentIcon={agentIcon}
        messages={messages}
        onSelectAsset={onSelectAsset}
        selectedAssetId={selectedAssetId}
      />
      <div className="p-3">
        <Composer
          agentId={agentId}
          agents={agents}
          busy={busy}
          onStop={onStop}
          hasSession={hasSession}
          focusSignal={focusSignal}
          onAttach={onAttach}
          onChange={onInputChange}
          onAgentChange={onAgentChange}
          onSend={onSend}
          // 空会话灵感卡：仅「有会话且无消息」时展示当前 Agent 的 presets
          presets={
            hasSession && messages.length === 0
              ? agents.find((a) => a.id === agentId)?.presets
              : undefined
          }
          reference={reference}
          onRemoveReference={onRemoveReference}
          value={input}
        />
      </div>
    </section>
  );
}
