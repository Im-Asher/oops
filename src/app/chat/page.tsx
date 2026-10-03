"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Composer } from "@/components/chat/floating-composer";
import { SessionDrawer } from "@/components/workbench/session-drawer";
import { ToolRail, type CanvasMode } from "@/components/workbench/tool-rail";
import { TopBar } from "@/components/workbench/top-bar";
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
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

/** 工具状态行的展示文案（按工具名；未收录的用通用文案）。 */
const TOOL_STATUS_LABELS: Record<string, string> = {
  generate_image: "正在生成图片…",
};

/** 每会话工作区槽：消息、输入草稿、进行中标记与画布引用（画布引用在创作闭环接线）。 */
interface SessionSlot {
  messages: UIMessage[];
  draft: string;
  busy: boolean;
  referenceAssetId: string | null;
}

const EMPTY_SLOT: SessionSlot = { messages: [], draft: "", busy: false, referenceAssetId: null };

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, SessionSlot>>({});
  const [agentId, setAgentId] = useState<string>("");
  const [canvas, dispatch] = useReducer(canvasReducer, initialCanvasState);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 工作台状态：聊天显隐（窄屏即聊天/画布切换）、画布模式、会话抽屉。
  const [chatOpen, setChatOpen] = useState(true);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState("");
  // 重命名/删除等会话操作的失败提示（抽屉内联展示）。
  const [actionError, setActionError] = useState<string | null>(null);
  const dirty = isDirty(canvas);
  const currentSlot = currentId ? slots[currentId] : undefined;
  const busy = currentSlot?.busy ?? false;

  const updateSlot = useCallback((id: string, fn: (slot: SessionSlot) => SessionSlot) => {
    setSlots((prev) => {
      const base = prev[id] ?? EMPTY_SLOT;
      return { ...prev, [id]: fn(base) };
    });
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      if (!currentId) return;
      updateSlot(currentId, (slot) => ({ ...slot, draft: value }));
    },
    [currentId, updateSlot],
  );

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

  // 缩略图上屏（过渡期）：窄屏同时切到画布视图。
  const handleActivateImage = useCallback((image: CanvasImage) => {
    dispatch({ type: "activate", image });
    setChatOpen(false);
  }, []);

  const bootstrappedRef = useRef(false);
  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as { sessions: SessionInfo[] };
    setSessions(data.sessions);
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      if (data.sessions[0]) setCurrentId(data.sessions[0].id);
    }
  }, []);

  const loadMessages = useCallback(
    async (id: string): Promise<UIMessage[]> => {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { messages: UIMessage[] };
      updateSlot(id, (slot) => ({ ...slot, messages: data.messages }));
      return data.messages;
    },
    [updateSlot],
  );

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
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentId) void selectSession(currentId);
    // selectSession 依赖仅 currentId：避免将其纳入依赖导致每渲染重拉消息。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  async function selectSession(id: string) {
    setCurrentId(id);
    // 会话切换即以会话绑定的 Agent 为准（重绑语义的展示面；存量空值回退当前选择）。
    const session = sessions.find((s) => s.id === id);
    if (session?.agentId) setAgentId(session.agentId);
    // 流式进行中的会话保留本地消息（SSE 持续写入该槽），否则以服务器为准刷新。
    if (slots[id]?.busy) return;
    const msgs = await loadMessages(id);
    // 过渡期：激活图回落到最近一张图（多作品画布落地后移除）。
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
      updateSlot(data.id, () => ({ ...EMPTY_SLOT }));
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
    setSlots((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (currentId === id) {
      if (remaining[0]) {
        void selectSession(remaining[0].id);
      } else {
        setCurrentId(null);
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
    const sessionId = currentId;
    const slot = sessionId ? slots[sessionId] : undefined;
    const text = slot?.draft.trim() ?? "";
    if (!sessionId || !slot || !text || slot.busy) return;
    updateSlot(sessionId, (s) => ({ ...s, draft: "", busy: true }));

    const userMsg: UIMessage = { id: `u${Date.now()}`, role: "user", parts: [{ type: "text", text }] };
    const assistantId = `a${Date.now()}`;
    const assistantMsg: UIMessage = { id: assistantId, role: "assistant", parts: [] };
    updateSlot(sessionId, (s) => ({ ...s, messages: [...s.messages, userMsg, assistantMsg] }));

    const updateAssistant = (fn: (parts: UIMessage["parts"]) => UIMessage["parts"]) =>
      updateSlot(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((msg) =>
          msg.id === assistantId ? { ...msg, parts: fn(msg.parts) } : msg,
        ),
      }));

    const appendText = (delta: string) =>
      updateAssistant((parts) => [...parts, { type: "text", text: delta }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, agentId, message: text }),
    });

    if (!res.body) {
      updateSlot(sessionId, (s) => ({ ...s, busy: false }));
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
    updateSlot(sessionId, (s) => ({ ...s, busy: false }));
    // 回合结束后刷新会话列表（首条消息自动标题 / updatedAt 排序）。
    void loadSessions();
  }

  const currentSession = sessions.find((s) => s.id === currentId);
  const sessionAgent =
    agents.find((a) => a.id === currentSession?.agentId) ??
    agents.find((a) => a.id === agentId);
  const messages = currentSlot?.messages ?? EMPTY_SLOT.messages;

  return (
    <main className="dark fixed inset-0 flex flex-col overflow-hidden bg-[#0B0B0D] text-zinc-50">
      <TopBar
        chatVisible={chatOpen}
        exportEnabled={dirty && !!canvas.active && !!currentId}
        exporting={exporting}
        onExport={() => void handleExport()}
        onToggleChat={() => setChatOpen((open) => !open)}
        saveStatus="idle"
        sessionTitle={currentSession?.title || (currentId ? "未命名会话" : "未选择会话")}
      />

      <div className="flex min-h-0 flex-1">
        <ToolRail
          chatVisible={chatOpen}
          mode={mode}
          onModeChange={setMode}
          onOpenSessions={() => setDrawerOpen(true)}
          onToggleChat={() => setChatOpen((open) => !open)}
        />

        {/* 聊天面板：桌面停靠 340px 可收起；窄屏与画布切换显示 */}
        <div
          className={`${chatOpen ? "flex" : "hidden"} w-full md:flex md:w-[340px] md:shrink-0`}
        >
          <ChatPanel
            activeUrl={canvas.active?.url ?? null}
            agentIcon={sessionAgent?.icon}
            agentId={agentId}
            agents={agents}
            busy={busy}
            hasSession={!!currentId}
            input={currentSlot?.draft ?? ""}
            messages={messages}
            onActivateImage={handleActivateImage}
            onAgentChange={(id) => void handleAgentChange(id)}
            onInputChange={handleInputChange}
            onSend={() => void send()}
          />
        </div>

        {/* 画布：工作区主体；聊天收起后扩展占满 */}
        <div
          className={`relative min-w-0 flex-1 ${chatOpen ? "hidden md:block" : "block"}`}
        >
          <CanvasStage
            crop={canvas.edit.crop}
            dirty={dirty}
            exporting={exporting}
            busy={busy}
            exportError={exportError}
            filters={canvas.edit.filters}
            image={canvas.active}
            onCropApply={handleCropApply}
            onExport={() => void handleExport()}
            onFiltersChange={handleFiltersChange}
            onResetEdits={handleResetEdits}
            onResetFilters={handleResetFilters}
            onResetView={handleResetView}
            onViewChange={handleViewChange}
            view={canvas.view}
          />
          {/* 悬浮输入框：聊天收起后出现（与停靠输入框共享草稿，组件同一套逻辑） */}
          {!chatOpen && currentId ? (
            <div className="absolute bottom-4 left-1/2 z-30 hidden w-[min(560px,calc(100%-2rem))] -translate-x-1/2 md:block">
              <Composer
                agentId={agentId}
                agents={agents}
                busy={busy}
                floating
                hasSession={!!currentId}
                onChange={handleInputChange}
                onAgentChange={(id) => void handleAgentChange(id)}
                onSend={() => void send()}
                value={currentSlot?.draft ?? ""}
              />
            </div>
          ) : null}
        </div>
      </div>

      <SessionDrawer
        agents={agents}
        currentId={currentId}
        errorMessage={actionError}
        onClose={() => setDrawerOpen(false)}
        onDeleteSession={(id) => void deleteSession(id)}
        onNewChat={() => void newChat()}
        onQueryChange={setDrawerQuery}
        onRenameSession={(id, title) => void renameSession(id, title)}
        onSelectSession={(id) => void selectSession(id)}
        open={drawerOpen}
        query={drawerQuery}
        sessions={sessions}
      />
    </main>
  );
}
