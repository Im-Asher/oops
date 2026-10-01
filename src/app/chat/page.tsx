"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { composeEditedImage } from "@/lib/canvas/export-canvas";
import { FloatingChatPanel } from "@/components/chat/floating-chat-panel";
import {
  canvasReducer,
  initialCanvasState,
  isDirty,
  type CanvasView,
  type CropRect,
  type Filters,
} from "@/lib/canvas/canvas-reducer";
import type { AgentInfo, ChatEvent, SessionInfo, UIMessage } from "@/types/chat";
import { useCallback, useEffect, useReducer, useState } from "react";

/** 工具状态行的展示文案（按工具名；未收录的用通用文案）。 */
const TOOL_STATUS_LABELS: Record<string, string> = {
  generate_image: "正在生成图片…",
};

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const [canvas, dispatch] = useReducer(canvasReducer, initialCanvasState);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const dirty = isDirty(canvas);

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
  const handleFiltersChange = useCallback(
    (filters: Partial<Filters>) => dispatch({ type: "setFilters", filters }),
    [],
  );
  const handleResetFilters = useCallback(() => dispatch({ type: "resetFilters" }), []);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
      if (!currentId && data.sessions[0]) setCurrentId(data.sessions[0].id);
    }
  }, [currentId]);

  // 仅拉取会话消息（不切视图/激活），用于导出后刷新聊天里的派生图消息。
  const loadMessages = useCallback(async (id: string): Promise<UIMessage[]> => {
    const res = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { messages: UIMessage[] };
    setMessages(data.messages);
    return data.messages;
  }, []);

  const handleResetEdits = useCallback(() => {
    dispatch({ type: "clearCrop" });
    dispatch({ type: "resetFilters" });
  }, []);

  const handleExport = useCallback(async () => {
    if (!canvas.active || !currentId || !dirty) return;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, width, height } = await composeEditedImage({
        url: canvas.active.url,
        crop: canvas.edit.crop,
        filters: canvas.edit.filters,
      });
      const form = new FormData();
      form.append("file", blob, "export.png");
      form.append("sessionId", currentId);
      form.append("sourceAssetId", canvas.active.assetId);
      form.append("edits", JSON.stringify({ crop: canvas.edit.crop, filters: canvas.edit.filters }));
      form.append("width", String(width));
      form.append("height", String(height));
      const res = await fetch("/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message ?? `导出失败（${res.status}）`);
      }
      await loadMessages(currentId);
      handleResetEdits();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }, [canvas.active, canvas.edit.crop, canvas.edit.filters, currentId, loadMessages, handleResetEdits, dirty]);

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
    // selectSession 依赖仅 currentId：避免将其纳入依赖导致每渲染重拉消息。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function selectSession(id: string) {
    dispatch({ type: "clear" });
    setCurrentId(id);
    const msgs = await loadMessages(id);
    // 加载会话时把激活图回落到最近一张图；不持久化视图状态（design Non-Goals）。
    const latest = [...msgs]
      .reverse()
      .flatMap((m) => m.parts)
      .find((p) => p.type === "image");
    if (latest?.type === "image") {
      dispatch({ type: "activate", image: { assetId: latest.assetId, url: latest.url } });
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

    const updateAssistant = (fn: (parts: UIMessage["parts"]) => UIMessage["parts"]) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id ? { ...msg, parts: fn(msg.parts) } : msg,
        ),
      );

    const appendText = (delta: string) =>
      updateAssistant((parts) => [...parts, { type: "text", text: delta }]);

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
      switch (event.type) {
        case "message_delta":
          appendText(event.text);
          break;
        case "thinking_start":
          // 整个回合的思考聚合为单个 thinking part（spec：当轮专用，不落库）
          updateAssistant((parts) =>
            parts.some((p) => p.type === "thinking")
              ? parts
              : [...parts, { type: "thinking", text: "", streaming: true }],
          );
          break;
        case "thinking_delta":
          updateAssistant((parts) => {
            if (!parts.some((p) => p.type === "thinking")) {
              return [...parts, { type: "thinking", text: event.text, streaming: true }];
            }
            return parts.map((p) =>
              p.type === "thinking" ? { ...p, text: p.text + event.text } : p,
            );
          });
          break;
        case "thinking_end":
          updateAssistant((parts) =>
            parts.map((p) =>
              p.type === "thinking" ? { ...p, streaming: false } : p,
            ),
          );
          break;
        case "tool_start":
          updateAssistant((parts) => [
            ...parts,
            {
              type: "tool_status",
              id: event.id,
              label: TOOL_STATUS_LABELS[event.name] ?? `正在执行 ${event.name}…`,
            },
          ]);
          break;
        case "tool_end": {
          updateAssistant((parts) => {
            const statusIdx = parts.findIndex(
              (p) => p.type === "tool_status" && p.id === event.id,
            );
            if (statusIdx === -1) return parts;
            const next = [...parts];
            if (event.details?.url) {
              // 成功：状态行原位替换为图片
              next[statusIdx] = {
                type: "image",
                url: String(event.details.url),
                assetId: String(event.details.assetId ?? ""),
              };
            } else {
              // 失败/非生图：移除状态行，原因由 Agent 文本解释
              next.splice(statusIdx, 1);
            }
            return next;
          });
          break;
        }
        case "error":
          appendText(`\n[错误] ${event.message}`);
          break;
        default:
          break;
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
        dirty={isDirty(canvas)}
        exporting={exporting}
        busy={busy}
        exportError={exportError}
        filters={canvas.edit.filters}
        image={canvas.active}
        onCropApply={handleCropApply}
        onExport={handleExport}
        onFiltersChange={handleFiltersChange}
        onResetEdits={handleResetEdits}
        onResetFilters={handleResetFilters}
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
