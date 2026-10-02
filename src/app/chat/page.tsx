"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { ChatColumn } from "@/components/chat/chat-column";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { Button } from "@/components/ui/button";
import { composeEditedImage } from "@/lib/canvas/export-canvas";
import {
  canvasReducer,
  initialCanvasState,
  isDirty,
  type CanvasImage,
  type CanvasView,
  type CropRect,
  type Filters,
} from "@/lib/canvas/canvas-reducer";
import type { AgentInfo, ChatEvent, SessionInfo, UIMessage } from "@/types/chat";
import { MessageSquareIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";
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
  // 三栏折叠状态（桌面端重排布局；移动端侧栏走抽屉、画布走浮层）。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [mobileCanvasOpen, setMobileCanvasOpen] = useState(false);
  // 重命名/删除等会话操作的失败提示（侧栏内联展示）。
  const [actionError, setActionError] = useState<string | null>(null);
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
  const handleResetEdits = useCallback(() => {
    dispatch({ type: "clearCrop" });
    dispatch({ type: "resetFilters" });
  }, []);

  // 缩略图上屏：移动端同时唤起画布浮层（画布列在窄屏不可见）。
  const handleActivateImage = useCallback((image: CanvasImage) => {
    dispatch({ type: "activate", image });
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileCanvasOpen(true);
    }
  }, []);

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
    // 会话切换即以会话绑定的 Agent 为准（重绑语义的展示面；存量空值回退当前选择）。
    const session = sessions.find((s) => s.id === id);
    if (session?.agentId) setAgentId(session.agentId);
    const msgs = await loadMessages(id);
    // 加载会话时把激活图回落到最近一张图；不持久化视图状态（design Non-Goals）。
    const latest = [...msgs]
      .reverse()
      .flatMap((m) => m.parts)
      .find((p) => p.type === "image");
    if (latest?.type === "image") {
      dispatch({ type: "activate", image: { assetId: latest.assetId, url: latest.url } });
    }
    setMobileCanvasOpen(false);
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
      setAgentId(data.agentId ?? agentId);
    }
  }

  /** 重命名会话：乐观更新本地列表，失败回滚并提示。 */
  async function renameSession(id: string, title: string) {
    const previous = sessions;
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)));
    setActionError(null);
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setSessions(previous);
      setActionError("重命名失败，请重试");
    }
  }

  /** 删除会话：服务端同步清理资产；删除当前会话后切换到相邻会话或空态。 */
  async function deleteSession(id: string) {
    setActionError(null);
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setActionError("删除失败（资产清理未完成），请重试");
      return;
    }
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (currentId === id) {
      if (remaining[0]) {
        void selectSession(remaining[0].id);
      } else {
        setCurrentId(null);
        setMessages([]);
        dispatch({ type: "clear" });
      }
    }
  }

  /**
   * Agent 语义：composer 切换 = 会话级重绑。
   * 新会话（无 currentId）仅更新待创建的选择；已有会话 PATCH 持久化，下一轮生效。
   */
  async function handleAgentChange(id: string) {
    setAgentId(id);
    if (!currentId) return;
    const res = await fetch(`/api/sessions/${currentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: id }),
    });
    if (res.ok) {
      setSessions((list) =>
        list.map((s) => (s.id === currentId ? { ...s, agentId: id } : s)),
      );
    } else {
      setActionError("Agent 切换失败，请重试");
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
    // 回合结束后刷新会话列表（首条消息自动标题 / updatedAt 排序）。
    void loadSessions();
  }

  const currentSession = sessions.find((s) => s.id === currentId);
  const sessionAgent =
    agents.find((a) => a.id === currentSession?.agentId) ??
    agents.find((a) => a.id === agentId);

  const canvasElement = (
    <CanvasStage
      crop={canvas.edit.crop}
      dirty={dirty}
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
  );

  const sidebar = (
    <SessionSidebar
      agents={agents}
      currentId={currentId}
      errorMessage={actionError}
      sessions={sessions}
      onDeleteSession={(id) => void deleteSession(id)}
      onCollapse={() => {
        setSidebarCollapsed(true);
        setSidebarDrawerOpen(false);
      }}
      onNewChat={() => void newChat()}
      onRenameSession={(id, title) => void renameSession(id, title)}
      onSelectSession={(id) => void selectSession(id)}
    />
  );

  return (
    <main className="dark fixed inset-0 flex overflow-hidden bg-[#0A0A0A] text-zinc-50">
      {/* 桌面：会话侧栏（可折叠） */}
      {!sidebarCollapsed && <div className="hidden md:flex">{sidebar}</div>}

      {/* 移动端：会话抽屉（overlay） */}
      {sidebarDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="关闭会话抽屉"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex">{sidebar}</div>
        </div>
      )}

      {/* 聊天列（移动端占满，桌面与画布分栏） */}
      {!chatCollapsed && (
        <div className="w-full md:w-auto md:min-w-0 md:flex-1">
          <ChatColumn
            activeUrl={canvas.active?.url ?? null}
            agentIcon={sessionAgent?.icon}
            agentId={agentId}
            agents={agents}
            busy={busy}
            input={input}
            messages={messages}
            onActivateImage={handleActivateImage}
            onAgentChange={(id) => void handleAgentChange(id)}
            onCollapse={() => setChatCollapsed(true)}
            onInputChange={setInput}
            onOpenSidebar={() => setSidebarDrawerOpen(true)}
            onSend={() => void send()}
            sessionTitle={currentSession?.title || "新会话"}
          />
        </div>
      )}

      {/* 桌面：画布列 */}
      <div className="relative hidden min-w-0 flex-1 md:block">{canvasElement}</div>

      {/* 折叠面板的一键唤回（桌面端） */}
      {(sidebarCollapsed || chatCollapsed) && (
        <div className="absolute left-3 top-3 z-30 hidden gap-1 md:flex">
          {sidebarCollapsed && (
            <Button
              aria-label="展开会话侧栏"
              className="min-h-11 min-w-11 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
              onClick={() => setSidebarCollapsed(false)}
              size="icon"
              variant="secondary"
            >
              <PanelLeftOpenIcon />
            </Button>
          )}
          {chatCollapsed && (
            <Button
              aria-label="展开聊天列"
              className="min-h-11 min-w-11 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
              onClick={() => setChatCollapsed(false)}
              size="icon"
              variant="secondary"
            >
              <MessageSquareIcon />
            </Button>
          )}
        </div>
      )}

      {/* 移动端：画布浮层 + 唤起入口 */}
      {canvas.active && !mobileCanvasOpen && (
        <Button
          aria-label="查看画布"
          className="fixed bottom-4 right-4 z-30 rounded-full md:hidden"
          onClick={() => setMobileCanvasOpen(true)}
          variant="secondary"
        >
          查看画布
        </Button>
      )}
      {mobileCanvasOpen && canvas.active && (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A] md:hidden">
          <Button
            aria-label="关闭画布"
            className="absolute right-3 top-3 z-50 min-h-11 min-w-11 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
            onClick={() => setMobileCanvasOpen(false)}
            size="icon"
            variant="secondary"
          >
            <XIcon />
          </Button>
          {canvasElement}
        </div>
      )}
    </main>
  );
}
