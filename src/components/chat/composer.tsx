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
import { ArrowUpIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export interface ComposerReference {
  assetId: string;
  name: string;
}

export interface ComposerPendingFile {
  id: string;
  name: string;
}

interface ComposerProps {
  agents: AgentInfo[];
  agentId: string;
  onAgentChange: (id: string) => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** busy 时停止按钮回调（提供则以停止钮替代禁用转圈）。 */
  onStop?: () => void;
  busy: boolean;
  hasSession: boolean;
  /** 当前引用的画布图片（可移除）。 */
  reference?: ComposerReference | null;
  onRemoveReference?: () => void;
  /** 外部聚焦信号：nonce 变化即聚焦一次（新建会话后带回聊天框）。 */
  focusSignal?: number;
  /** 附件上传参考图入口；无会话时不提供（按钮禁用提示）。 */
  onAttach?: () => void;
  /** 空会话灵感卡：当前 Agent 的示例需求文案（点击填入不发送）。 */
  presets?: string[];
  /** landing：首页直发形态——无会话门槛（会话在画布侧创建），其余能力与画布一致。 */
  variant?: "default" | "landing";
  /** landing 待传附件 chip（跳转后在画布侧真实上传）。 */
  pendingFiles?: ComposerPendingFile[];
  onRemovePendingFile?: (id: string) => void;
}

/**
 * 聊天输入框：停靠于聊天面板底部；
 * 草稿/Agent 选择/引用由页面状态持有。
 * landing 变体：首页直发——无会话门槛；灵感卡/引用/pendingFiles 是否呈现
 * 完全由调用方传参决定，组件不按 variant 额外屏蔽。
 * IME 守卫：中文输入法组合期间的 Enter 不触发发送。
 */
export function Composer({
  agents,
  agentId,
  onAgentChange,
  value,
  onChange,
  onSend,
  onStop,
  busy,
  hasSession,
  reference,
  onRemoveReference,
  focusSignal,
  onAttach,
  presets,
  variant,
  pendingFiles,
  onRemovePendingFile,
}: ComposerProps) {
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // landing 形态下会话在跳转后由画布创建，首页输入不设门槛。
  const sessionReady = variant === "landing" || hasSession;
  // landing 语境下无「会话」概念，附件钮文案随之调整。
  const attachLabel = onAttach
    ? variant === "landing"
      ? "添加附件"
      : "上传参考图"
    : "先创建会话后可上传参考图";

  // 聚焦信号 nonce 变化即聚焦一次（新建会话后带回聊天框）。
  useEffect(() => {
    if (focusSignal) textareaRef.current?.focus();
  }, [focusSignal]);

  /** 灵感卡点击：填入草稿（父层受控更新）并聚焦输入框，不自动发送。 */
  function pickPreset(text: string) {
    onChange(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring">
      {presets?.length ? (
        <div className="flex flex-col gap-1.5 px-1 pb-2" data-testid="preset-cards">
          <p className="text-xs text-muted-foreground/80">试试这样描述：</p>
          {presets.map((text) => (
            <button
              className="flex items-start gap-2 rounded-lg border border-border bg-popover/60 px-3 py-2 text-left text-xs text-foreground/80 hover:border-ring hover:bg-accent"
              key={text}
              onClick={() => pickPreset(text)}
              type="button"
            >
              <span aria-hidden>💡</span>
              <span>{text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {reference ? (
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-1 text-xs text-violet-600 dark:text-violet-300">
            引用：{reference.name}
            <button
              aria-label={`移除引用 ${reference.name}`}
              className="ml-0.5 text-violet-600/80 dark:text-violet-600 dark:text-violet-300/80 hover:text-violet-700 dark:hover:text-violet-700 dark:text-violet-200"
              onClick={onRemoveReference}
              type="button"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        </div>
      ) : null}
      {pendingFiles?.length ? (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1.5" data-testid="composer-pending-files">
          {pendingFiles.map((f) => (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-1 text-xs text-violet-600 dark:text-violet-300"
              key={f.id}
            >
              附件：{f.name}
              <button
                aria-label={`移除附件 ${f.name}`}
                className="ml-0.5 hover:text-violet-700 dark:hover:text-violet-200"
                onClick={() => onRemovePendingFile?.(f.id)}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Textarea
        aria-label="消息输入"
        ref={textareaRef}
        className="field-sizing-content max-h-40 min-h-10 resize-none border-0 bg-transparent p-1.5 text-sm text-foreground shadow-none placeholder:text-muted-foreground/80 focus-visible:ring-0"
        disabled={busy || !sessionReady}
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
        placeholder={sessionReady ? "描述你的设计需求…" : "先创建会话"}
        rows={1}
        value={value}
      />
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-0.5">
          <Button
            aria-label={attachLabel}
            className="size-8 text-muted-foreground hover:bg-accent hover:text-foreground/85"
            disabled={!onAttach}
            onClick={onAttach}
            size="icon-sm"
            title={attachLabel}
            variant="ghost"
          >
            <PaperclipIcon />
          </Button>
          <Select onValueChange={onAgentChange} value={agentId}>
            <SelectTrigger
              aria-label="选择 Agent"
              className="w-auto gap-1.5 border-0 bg-transparent px-2 text-xs text-foreground/80 shadow-none hover:bg-accent"
              size="sm"
            >
              <SelectValue placeholder="选择 Agent" />
            </SelectTrigger>
            <SelectContent className="bg-popover text-foreground">
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
        </div>
        {busy && onStop ? (
          // 生成中：发送钮变为停止钮（点击中断本轮流，服务端真停并部分落库）
          <Button
            aria-label="停止生成"
            className="size-8 rounded-full bg-accent hover:bg-accent/80"
            onClick={onStop}
            size="icon-sm"
            title="停止生成"
          >
            <SquareIcon className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            aria-label="发送"
            className="size-8 rounded-full bg-violet-500/90 hover:bg-violet-500"
            disabled={busy || !sessionReady || !value.trim()}
            onClick={onSend}
            size="icon-sm"
          >
            {busy ? (
              <span className="block size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
