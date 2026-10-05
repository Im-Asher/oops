"use client";

import { Composer, type ComposerReference } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
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
 * 聊天面板：停靠左侧 340px，展示需求、回复、任务状态与结果摘要。
 * 输入框仅存在此停靠形态；收起面板后无任何输入框（草稿由页面状态保留）。
 */
export function ChatPanel({
  agents,
  agentId,
  onAgentChange,
  agentIcon,
  hasSession,
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
    <section aria-label="聊天面板" className="flex h-full w-full min-w-0 flex-col bg-[#141416]">
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
          reference={reference}
          onRemoveReference={onRemoveReference}
          value={input}
        />
      </div>
    </section>
  );
}
