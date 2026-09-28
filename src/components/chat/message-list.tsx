"use client";

import { ImageThumbnail } from "@/components/chat/image-thumbnail";
import type { CanvasImage } from "@/lib/canvas/canvas-reducer";
import type { UIMessage } from "@/types/chat";
import { useEffect, useRef } from "react";

interface MessageListProps {
  messages: UIMessage[];
  activeUrl?: string | null;
  onActivateImage?: (image: CanvasImage) => void;
}

/**
 * 消息渲染：从简版聊天页原样迁出，仅适配悬浮面板的深色配色。
 * 流式追加、工具态、错误解释等行为保持不变。
 */
export function MessageList({ messages, activeUrl, onActivateImage }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // 图片按出现顺序编号，让每张缩略图有可区分的无障碍名称。
  const imagePositions = new Map<string, number>();
  let seq = 0;
  for (const m of messages) {
    m.parts.forEach((p, pi) => {
      if (p.type === "image") imagePositions.set(`${m.id}:${pi}`, ++seq);
    });
  }

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
                <ImageThumbnail
                  active={activeUrl === p.url}
                  key={i}
                  onActivate={() => onActivateImage?.({ assetId: p.assetId, url: p.url })}
                  position={imagePositions.get(`${m.id}:${i}`) ?? 0}
                  url={p.url}
                />
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
