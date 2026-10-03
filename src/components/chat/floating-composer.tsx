"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { shouldSendOnEnter } from "@/lib/chat/keyboard";
import type { AgentInfo } from "@/types/chat";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { useRef } from "react";

export interface ComposerReference {
  assetId: string;
  name: string;
}

interface ComposerProps {
  agents: AgentInfo[];
  agentId: string;
  onAgentChange: (id: string) => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  hasSession: boolean;
  /** 当前引用的画布图片（可移除）。 */
  reference?: ComposerReference | null;
  onRemoveReference?: () => void;
  /** 悬浮形态（画布底部）加深阴影；定位由父容器负责。 */
  floating?: boolean;
}

/**
 * 双形态输入框：聊天面板底部停靠与画布底部悬浮共用同一组件实例逻辑，
 * 草稿/Agent 选择/引用由页面状态持有，两种形态读写同一份数据。
 * IME 守卫：中文输入法组合期间的 Enter 不触发发送。
 */
export function Composer({
  agents,
  agentId,
  onAgentChange,
  value,
  onChange,
  onSend,
  busy,
  hasSession,
  reference,
  onRemoveReference,
  floating,
}: ComposerProps) {
  const composingRef = useRef(false);

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-[#141416] p-2 transition-colors focus-within:border-zinc-600 ${
        floating ? "shadow-lg shadow-black/30" : ""
      }`}
    >
      {reference ? (
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-1 text-xs text-violet-300">
            引用：{reference.name}
            <button
              aria-label={`移除引用 ${reference.name}`}
              className="ml-0.5 text-violet-300/80 hover:text-violet-200"
              onClick={onRemoveReference}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        </div>
      ) : null}
      <Textarea
        aria-label="消息输入"
        className="field-sizing-content max-h-40 min-h-10 resize-none border-0 bg-transparent p-1.5 text-sm text-zinc-50 shadow-none placeholder:text-zinc-500 focus-visible:ring-0"
        disabled={busy || !hasSession}
        onBlur={() => {
          composingRef.current = false;
        }}
        onChange={(e) => onChange(e.target.value)}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onKeyDown={(e) => {
          if (
            !shouldSendOnEnter({
              key: e.key,
              shiftKey: e.shiftKey,
              isComposing: e.nativeEvent.isComposing,
              composing: composingRef.current,
            })
          ) {
            return;
          }
          e.preventDefault();
          onSend();
        }}
        placeholder={hasSession ? "描述你的图片需求…" : "先在会话抽屉新建会话"}
        rows={1}
        value={value}
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
          className="size-8 rounded-full bg-violet-500/90 hover:bg-violet-500"
          disabled={busy || !hasSession || !value.trim()}
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
  );
}
