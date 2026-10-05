"use client";

import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ResultChip } from "@/components/chat/result-chip";
import type { UIMessage } from "@/types/chat";
import { BrainIcon, LoaderCircleIcon, UserIcon } from "lucide-react";
import { useEffect, useRef } from "react";

interface MessageListProps {
  messages: UIMessage[];
  /** 画布当前选中条目的 assetId（缩略图高亮依据）。 */
  selectedAssetId?: string | null;
  /** 当前会话所属 Agent 的头像 emoji（assistant 消息徽标）。 */
  agentIcon?: string;
  onSelectAsset?: (assetId: string) => void;
}

function AgentAvatar({ icon }: { icon?: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm leading-none"
    >
      {icon ?? <BrainIcon className="size-3.5 text-muted-foreground" />}
    </span>
  );
}

function UserAvatar() {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-foreground/85"
    >
      <UserIcon className="size-3.5" />
    </span>
  );
}

/**
 * 相邻 text parts 合并：流式增量各自成 part，而 MessageContent 为 flex-col，
 * 不合并会导致每个增量各占一行、文字碎片化。
 */
function mergeTextParts(parts: UIMessage["parts"]): UIMessage["parts"] {
  const merged: UIMessage["parts"] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.type === "text" && last?.type === "text") {
      merged[merged.length - 1] = { type: "text", text: last.text + p.text };
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/** 等待首个可见内容（文字/思考/状态行）时的占位动画，不依赖服务端事件。 */
function ThinkingPlaceholder() {
  return (
    <span aria-label="思考中" className="inline-flex items-center gap-1 py-1.5">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </span>
  );
}

function ToolStatusLine({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <LoaderCircleIcon className="size-3 animate-spin" />
      {label}
    </span>
  );
}

/**
 * 消息渲染：AI Elements Message 容器 + 角色头像 + 进行中反馈。
 * 图片 part 渲染为结果摘要 chip：点击把画布定位到对应条目并选中。
 */
export function MessageList({
  messages,
  selectedAssetId,
  agentIcon,
  onSelectAsset,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // 图片按出现顺序编号，让每个摘要 chip 有可区分的无障碍名称。
  // 键基于合并后的 parts 索引，与渲染循环一致。
  const imagePositions = new Map<string, number>();
  let seq = 0;
  for (const m of messages) {
    mergeTextParts(m.parts).forEach((p, pi) => {
      if (p.type === "image") imagePositions.set(`${m.id}:${pi}`, ++seq);
    });
  }

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-3" role="log">
      {messages.map((m, idx) => {
        const isUser = m.role === "user";
        const isLast = idx === messages.length - 1;
        const emptyStreaming = !isUser && isLast && m.parts.length === 0;
        return (
          <div
            key={m.id}
            className={`flex w-full items-start gap-2 ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            {!isUser && <AgentAvatar icon={agentIcon} />}
            <Message from={m.role} className="max-w-[85%] min-w-0">
              <MessageContent>
                {emptyStreaming && <ThinkingPlaceholder />}
                {mergeTextParts(m.parts).map((p, i) => {
                  switch (p.type) {
                    case "text":
                      return (
                        <span className="whitespace-pre-wrap" key={i}>
                          {p.text}
                        </span>
                      );
                    case "image":
                      return (
                        <ResultChip
                          active={selectedAssetId === p.assetId}
                          key={i}
                          onFocus={() => onSelectAsset?.(p.assetId)}
                          position={imagePositions.get(`${m.id}:${i}`) ?? 0}
                        />
                      );
                    case "file":
                      return (
                        <a className="underline" href={p.url} key={i}>
                          文件
                        </a>
                      );
                    case "thinking":
                      return (
                        <Reasoning isStreaming={p.streaming} key={i}>
                          <ReasoningTrigger />
                          <ReasoningContent>{p.text}</ReasoningContent>
                        </Reasoning>
                      );
                    case "tool_status":
                      return <ToolStatusLine key={i} label={p.label} />;
                  }
                })}
              </MessageContent>
            </Message>
            {isUser && <UserAvatar />}
          </div>
        );
      })}
      {messages.length === 0 && (
        <p className="text-sm text-muted-foreground">选择 Agent 并描述你想要的商品/场景图。</p>
      )}
    </div>
  );
}
