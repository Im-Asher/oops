"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { FloatingChatPanel } from "@/components/chat/floating-chat-panel";
import {
  canvasReducer,
  initialCanvasState,
  type CanvasView,
  type CropRect,
} from "@/lib/canvas/canvas-reducer";
import type { AgentInfo, ChatEvent, SessionInfo, UIMessage } from "@/types/chat";
import { useCallback, useEffect, useReducer, useState } from "react";

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const [canvas, dispatch] = useReducer(canvasReducer, initialCanvasState);

  // dispatch 引用稳定，回调保持同一身份，避免画布每渲染都重挂滚轮监听。
  const handleViewChange = useCallback(
    (view: CanvasView) => dispatch({ type: "setView", view }),
    [],
  );
  const handleResetView = useCallback(() => dispatch({ type: "resetView" }), []);
  const handleCropApply = useCallback(
    (crop: CropRect) => dispatch({ type: "setCrop", crop }),
    [],
  );

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
      if (!currentId && data.sessions[0]) setCurrentId(data.sessions[0].id);
    }
  }, [currentId]);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: AgentInfo[] }) => {
        setAgents(d.agents);
        if (d.agents[0]) setAgentId(d.agents[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentId) void selectSession(currentId);
  }, [currentId]);

  async function selectSession(id: string) {
    dispatch({ type: "clear" });
    setCurrentId(id);
    const res = await fetch(`/api/sessions/${id}`);
    if (res.ok) {
      const data = (await res.json()) as { messages: UIMessage[] };
      setMessages(data.messages);
      // 加载会话时把激活图回落到最近一张图；不持久化视图状态（design Non-Goals）。
      const latest = [...data.messages]
        .reverse()
        .flatMap((m) => m.parts)
        .find((p) => p.type === "image");
      if (latest?.type === "image") {
        dispatch({ type: "activate", image: { assetId: latest.assetId, url: latest.url } });
      }
    }
  }

  async function newChat() {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    if (res.ok) {
      const data = (await res.json()) as SessionInfo;
      setSessions((s) => [data, ...s]);
      setMessages([]);
      dispatch({ type: "clear" });
      setCurrentId(data.id);
    }
  }

  async function send() {
    if (!input.trim() || !currentId || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);

    const userMsg: UIMessage = { id: `u${Date.now()}`, role: "user", parts: [{ type: "text", text }] };
    const assistantMsg: UIMessage = { id: `a${Date.now()}`, role: "assistant", parts: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    const appendText = (delta: string) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id
            ? { ...msg, parts: [...msg.parts, { type: "text", text: delta }] }
            : msg,
        ),
      );
    const appendImage = (url: string, assetId: string) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id
            ? { ...msg, parts: [...msg.parts, { type: "image", url, assetId }] }
            : msg,
        ),
      );

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentId, agentId, message: text }),
    });

    if (!res.body) {
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleEvent = (event: ChatEvent) => {
      if (event.type === "message_delta") appendText(event.text);
      else if (event.type === "tool_end" && event.details?.url) {
        appendImage(String(event.details.url), String(event.details.assetId ?? ""));
      } else if (event.type === "error") {
        appendText(`\n[错误] ${event.message}`);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let eventType = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (eventType && data) {
          try {
            handleEvent({ type: eventType, ...JSON.parse(data) } as ChatEvent);
          } catch {
            /* ignore malformed */
          }
        }
      }
    }
    setBusy(false);
  }

  return (
    <main className="dark fixed inset-0 overflow-hidden bg-[#0A0A0A]">
      <CanvasStage
        crop={canvas.edit.crop}
        image={canvas.active}
        onCropApply={handleCropApply}
        onResetView={handleResetView}
        onViewChange={handleViewChange}
        view={canvas.view}
      />
      <FloatingChatPanel
        activeUrl={canvas.active?.url ?? null}
        onActivateImage={(image) => dispatch({ type: "activate", image })}
        agentId={agentId}
        agents={agents}
        busy={busy}
        currentId={currentId}
        input={input}
        messages={messages}
        onAgentChange={setAgentId}
        onInputChange={setInput}
        onNewChat={() => void newChat()}
        onSelectSession={(id) => void selectSession(id)}
        onSend={() => void send()}
        sessions={sessions}
      />
    </main>
  );
}
