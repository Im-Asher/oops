"use client";

import type { UIMessage } from "@/types/chat";
import { useEffect, useRef } from "react";

/**
 * 消息渲染：从简版聊天页原样迁出，仅适配悬浮面板的深色配色。
 * 流式追加、工具态、错误解释等行为保持不变。
 */
export function MessageList({ messages }: { messages: UIMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-3" role="log">
      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
          <div
            className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              m.role === "user" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-50"
            }`}
          >
            {m.parts.map((p, i) =>
              p.type === "text" ? (
                <span key={i}>{p.text}</span>
              ) : p.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p.url} alt="生成结果" className="mt-2 max-h-80 rounded" />
              ) : (
                <a key={i} href={p.url} className="underline">
                  文件
                </a>
              ),
            )}
          </div>
        </div>
      ))}
      {messages.length === 0 && (
        <p className="text-sm text-zinc-400">
          新建会话，向“氛围图设计师”描述你想要的商品/场景图。
        </p>
      )}
    </div>
  );
}
