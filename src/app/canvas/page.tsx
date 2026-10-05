"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/chat-panel";
import { SessionDrawer } from "@/components/workbench/session-drawer";
import { composeEditedImage } from "@/lib/canvas/export-canvas";
import { DownloadIcon, MessageSquareIcon } from "lucide-react";
import {
  canvasReducer,
  initialCanvasState,
  isDirty,
  selectedItem,
} from "@/lib/canvas/canvas-reducer";
import { centerViewOn, rectVisibleInViewport } from "@/lib/canvas/coords";
import { itemRect } from "@/lib/canvas/layout";
import type { CanvasItem } from "@/lib/canvas/canvas-reducer";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "@/lib/canvas/workspace-storage";
import type { AgentInfo, ChatEvent, SessionInfo, UIMessage } from "@/types/chat";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

/** 工具状态行的展示文案（按工具名；未收录的用通用文案）。 */
const TOOL_STATUS_LABELS: Record<string, string> = {
  generate_image: "正在生成图片…",
};

/** 每会话工作区槽：消息、输入草稿与进行中标记（引用即画布选中，不单独存槽）。 */
interface SessionSlot {
  messages: UIMessage[];
  draft: string;
  busy: boolean;
}

const EMPTY_SLOT: SessionSlot = { messages: [], draft: "", busy: false };

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, SessionSlot>>({});
  const [agentId, setAgentId] = useState<string>("");
  const [canvas, dispatch] = useReducer(canvasReducer, initialCanvasState);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 工作台状态：聊天显隐（窄屏即聊天/画布切换）、会话抽屉。
  const [chatOpen, setChatOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 输入框外部聚焦信号：新建会话后带回聊天框（nonce 变化触发聚焦一次）。
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [drawerQuery, setDrawerQuery] = useState("");
  // 重命名/删除等会话操作的失败提示（抽屉内联展示）。
  const [actionError, setActionError] = useState<string | null>(null);
  // 会话工作区本机持久化：保存状态机（顶栏如实显示）+ 已完成恢复的会话标记。
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredForRef = useRef<string | null>(null);
  const dirty = isDirty(canvas);
  const selectedCanvasItem = selectedItem(canvas);
  const currentSlot = currentId ? slots[currentId] : undefined;
  const messages = currentSlot?.messages ?? EMPTY_SLOT.messages;
  const busy = currentSlot?.busy ?? false;

  // SSE 回合内的画布事件按发起会话归档：仅当发起会话仍是当前会话才上画布，
  // 流中切会话不串图（槽内消息仍照常归档，切回时由 deriveImages 重建）。
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

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

  const handleResetEdits = useCallback(() => {
    const sel = selectedItem(canvas);
    if (!sel) return;
    dispatch({ type: "setCrop", id: sel.id, crop: null });
    dispatch({ type: "resetFilters", id: sel.id });
  }, [canvas]);

  // 摘要 chip 定位请求（nonce 驱动 CanvasStage 的定位 effect）。
  const [focus, setFocus] = useState<{ assetId: string; nonce: number } | null>(null);
  // 新结果提示请求：null 即无提示（结果在视口内静默完成）。
  const [reveal, setReveal] = useState<{ assetId: string; nonce: number } | null>(null);
  // 视口判定数据：画布状态镜像（SSE 流闭包内读最新值）与画布包裹层尺寸。
  const canvasStateRef = useRef(canvas);
  useEffect(() => {
    canvasStateRef.current = canvas;
  }, [canvas]);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  /** "有新结果"chip 点击：以当前缩放定位并选中该结果，同时收起提示。 */
  function handleRevealClick() {
    const chip = reveal;
    setReveal(null);
    if (!chip) return;
    const item = canvas.items.find((i) => i.assetId === chip.assetId);
    const el = canvasWrapRef.current;
    if (!item || !el) return;
    const next = centerViewOn(
      itemRect(item),
      { width: el.clientWidth, height: el.clientHeight },
      canvas.view.scale,
    );
    dispatch({ type: "select", id: item.id });
    dispatch({ type: "setView", view: next });
  }

  /**
   * 聊天摘要点击 → 画布定位并选中该 asset。
   * 条目尚未在画布时（如直接点历史消息）先按消息补派生，再由 stage 定位。
   */
  const handleFocusAsset = useCallback(
    (assetId: string) => {
      const exists = canvas.items.some((i) => i.assetId === assetId);
      if (!exists) {
        const image = messages
          .flatMap((m) => m.parts)
          .find((p): p is Extract<UIMessage["parts"][number], { type: "image" }> =>
            p.type === "image" && p.assetId === assetId,
          );
        if (image) dispatch({ type: "addImageItems", images: [{ assetId: image.assetId, url: image.url }] });
      }
      // 窄屏聊天/画布互斥：定位是明确的看图意图，自动切到画布视图。
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        setChatOpen(false);
      }
      setFocus({ assetId, nonce: Date.now() });
    },
    [canvas.items, messages],
  );

  /** 从会话消息的图片 part 派生画布条目（幂等，按 assetId 去重；placeNew 排布）。 */
  const deriveImages = useCallback((messages: UIMessage[]) => {
    const images = messages.flatMap((m) =>
      m.parts.flatMap((p) => (p.type === "image" ? [{ assetId: p.assetId, url: p.url }] : [])),
    );
    if (images.length) dispatch({ type: "addImageItems", images });
  }, []);

  // 参考图上传：走 /upload purpose=reference（绑会话资产、不写聊天消息），上画布并选中即引用。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const uploadReference = useCallback(
    async (file: File) => {
      if (!currentId) return;
      setReferenceError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("purpose", "reference");
        form.append("sessionId", currentId);
        const res = await fetch("/upload", { method: "POST", body: form });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(err?.error?.message ?? `参考图上传失败（${res.status}）`);
        }
        const data = (await res.json()) as { assetId: string; url: string };
        dispatch({
          type: "addImageItems",
          images: [{ assetId: data.assetId, url: data.url, name: file.name }],
          selectNew: true,
        });
      } catch (e) {
        setReferenceError(e instanceof Error ? e.message : "参考图上传失败");
      }
    },
    [currentId],
  );

  // 会话工作区本机持久化：画布/草稿变化 300ms 防抖落盘；未完成恢复的会话不写，避免切换瞬间用清空态覆盖。
  useEffect(() => {
    if (!currentId || restoredForRef.current !== currentId) return;
    const snapshot = {
      positions: Object.fromEntries(
        canvas.items.map((i) => [i.assetId, { x: i.x, y: i.y }]),
      ),
      view: canvas.view,
      draft: currentSlot?.draft ?? "",
      referenceAssetId: selectedCanvasItem?.assetId ?? null,
    };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(() => {
      saveWorkspace(currentId, snapshot);
      setSaveStatus("saved");
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [canvas, currentSlot, currentId, selectedCanvasItem]);

  /** 切回会话后贴回本机工作区：位置/视角/草稿/引用选中。 */
  function restoreWorkspace(id: string) {
    const snapshot = loadWorkspace(id);
    if (snapshot) {
      dispatch({
        type: "restoreSnapshot",
        positions: snapshot.positions,
        view: snapshot.view,
        referenceAssetId: snapshot.referenceAssetId,
      });
      updateSlot(id, (s) => ({ ...s, draft: snapshot.draft }));
    }
    restoredForRef.current = id;
  }

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
    const sel = selectedItem(canvas);
    if (!sel || sel.status !== "image" || !currentId || !dirty) return;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, width, height } = await composeEditedImage({
        url: sel.url,
        crop: sel.edit.crop,
        filters: sel.edit.filters,
      });
      const form = new FormData();
      form.append("file", blob, "export.png");
      form.append("sessionId", currentId);
      form.append("sourceAssetId", sel.assetId);
      form.append("edits", JSON.stringify({ crop: sel.edit.crop, filters: sel.edit.filters }));
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
  }, [canvas, currentId, loadMessages, handleResetEdits, dirty]);

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
    // 画布随会话切换重建：从该会话消息图片 part 派生条目（会话级持久化在 4.1 接入）。
    dispatch({ type: "clear" });
    // 流式进行中的会话保留本地消息（SSE 持续写入该槽），否则以服务器为准刷新。
    const cached = slots[id];
    setReveal(null);
    if (cached?.busy) {
      deriveImages(cached.messages);
      restoreWorkspace(id);
      return;
    }
    const msgs = await loadMessages(id);
    deriveImages(msgs);
    restoreWorkspace(id);
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
      dispatch({ type: "clear" });
      restoredForRef.current = data.id;
      setReveal(null);
      setCurrentId(data.id);
      setAgentId(data.agentId ?? agentId);
      // 新建会话转到聊天框：关抽屉、展开聊天面板并聚焦输入框。
      setDrawerOpen(false);
      setChatOpen(true);
      setComposerFocusNonce((n) => n + 1);
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
    clearWorkspace(id);
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

  /**
   * 一轮对话公共体：busy 守卫、消息落槽、SSE 流读取与事件归档。
   * 正常发送（引用取画布选中）与失败占位卡重试（引用取卡内原始意图）共用。
   */
  // 本轮中断控制器：busy 时发送按钮变为停止按钮（见 stopGeneration）。
  const abortRef = useRef<AbortController | null>(null);
  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function runRound(sessionId: string, text: string, roundRefs: string[]) {
    const slot = slots[sessionId];
    if (!slot || !text || slot.busy) return;
    updateSlot(sessionId, (s) => ({ ...s, busy: true }));
    // 本轮画布占位卡记账：SSE error/断流时统一收尾置失败。
    const roundPlaceholders: string[] = [];
    function failPendingPlaceholders(targetSessionId: string, message: string) {
      if (currentIdRef.current !== targetSessionId) return;
      for (const pid of roundPlaceholders) {
        const item = canvasStateRef.current.items.find((i) => i.id === pid);
        if (item?.status === "generating") {
          dispatch({
            type: "patchItem",
            id: pid,
            patch: { status: "failed", errorMessage: message },
          });
        }
      }
    }

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

    const ac = new AbortController();
    abortRef.current = ac;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        sessionId,
        agentId,
        message: text,
        ...(roundRefs.length ? { referenceAssetIds: roundRefs } : {}),
      }),
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
        case "tool_start": {
          // 画布占位卡：生成工具有引用时邻近放置（血缘取模型传参，回退本轮选中引用）。
          // 已知限制：生成中刷新页面会丢失占位卡（本地态），且本轮 SSE 不恢复；
          // 服务端任务与消息仍在，刷新后重新拉取消息由 deriveImages 重建已完成的图。
          if (currentIdRef.current === sessionId && event.name === "generate_image") {
            const args = (event.args ?? {}) as { referenceAssetId?: unknown; prompt?: unknown };
            roundPlaceholders.push(event.id);
            dispatch({
              type: "addPlaceholder",
              id: event.id,
              referenceAssetId:
                typeof args.referenceAssetId === "string" && args.referenceAssetId
                  ? args.referenceAssetId
                  : roundRefs[0],
              prompt: typeof args.prompt === "string" ? args.prompt : undefined,
            });
          }
          updateAssistant((parts) => [
            ...parts,
            {
              type: "tool_status",
              id: event.id,
              label: TOOL_STATUS_LABELS[event.name] ?? `正在执行 ${event.name}…`,
            },
          ]);
          break;
        }
        case "tool_end": {
          // 占位卡原位结算：成功换图、失败置失败卡（不在当前会话时由切回后的 deriveImages 重建）。
          if (currentIdRef.current === sessionId) {
            if (event.details?.url) {
              const newAssetId = String(event.details.assetId ?? "");
              dispatch({
                type: "patchItem",
                id: event.id,
                patch: {
                  assetId: newAssetId,
                  url: String(event.details.url),
                  status: "image",
                },
              });
              // 新结果定位提示：结果矩形不在当前视口内才浮 chip（打断与否由用户视角决定）。
              if (newAssetId) {
                const st = canvasStateRef.current;
                const item = st.items.find((i) => i.id === event.id);
                const el = canvasWrapRef.current;
                const visible =
                  item && el
                    ? rectVisibleInViewport(
                        itemRect(item),
                        st.view,
                        { width: el.clientWidth, height: el.clientHeight },
                      )
                    : true;
                setReveal(visible ? null : { assetId: newAssetId, nonce: Date.now() });
              }
            } else {
              dispatch({
                type: "patchItem",
                id: event.id,
                patch: {
                  status: "failed",
                  errorMessage: String(event.details?.message ?? "生成失败"),
                },
              });
            }
          }
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
          // 聊天与画布一致呈现：本轮仍在生成中的占位卡同步置失败，不留悬空转圈。
          failPendingPlaceholders(sessionId, event.message);
          break;
        default:
          break;
      }
    };

    try {
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
    } catch {
      if (ac.signal.aborted) {
        // 用户主动停止：当轮标记已停止（仅本轮 UI 状态，不进持久化正文），
        // 未结算占位卡移除——服务端已将已生成部分落库，刷新后以部分内容呈现。
        appendText("\n[已停止生成]");
        if (currentIdRef.current === sessionId) {
          for (const pid of roundPlaceholders) {
            const item = canvasStateRef.current.items.find((i) => i.id === pid);
            if (item?.status === "generating") dispatch({ type: "removeItem", id: pid });
          }
        }
      } else {
        // 网络/流中断：聊天侧补错误行，画布侧未结算占位卡置失败（服务端回合可能已完成，切回会话时以服务器为准）。
        appendText("\n[错误] 连接中断，请重试");
        failPendingPlaceholders(sessionId, "连接中断，生成未完成");
      }
    } finally {
      abortRef.current = null;
      updateSlot(sessionId, (s) => ({ ...s, busy: false }));
      // 回合结束后刷新会话列表（首条消息自动标题 / updatedAt 排序）。
      void loadSessions();
    }
  }

  async function send() {
    const sessionId = currentId;
    const slot = sessionId ? slots[sessionId] : undefined;
    const text = slot?.draft.trim() ?? "";
    if (!sessionId || !slot || !text || slot.busy) return;
    // 引用 = 画布选中条目（无选中 = 新方案）；快照后清草稿。
    const sel = selectedItem(canvas);
    const roundRefs = sel && sel.status === "image" ? [sel.assetId] : [];
    updateSlot(sessionId, (s) => ({ ...s, draft: "" }));
    await runRound(sessionId, text, roundRefs);
  }

  /** 失败占位卡重试：以卡内保存的原始意图（prompt + 原引用）重新发起一轮。 */
  function retryItem(item: CanvasItem) {
    if (!currentId || busy) return;
    const text = item.prompt ? `重新生成：${item.prompt}` : "重新生成上次的图片";
    const refs = item.referenceAssetId ? [item.referenceAssetId] : [];
    void runRound(currentId, text, refs);
  }

  const currentSession = sessions.find((s) => s.id === currentId);
  const sessionAgent =
    agents.find((a) => a.id === currentSession?.agentId) ??
    agents.find((a) => a.id === agentId);
  // 引用 = 画布选中的图片条目；移除 chip = 取消选中（无选中 = 新方案）。
  const composerReference =
    selectedCanvasItem && selectedCanvasItem.status === "image"
      ? { assetId: selectedCanvasItem.assetId, name: selectedCanvasItem.name ?? "画布图片" }
      : null;

  return (
    <main className="dark fixed inset-0 overflow-hidden bg-[#0B0B0D] text-zinc-50">
      {/* 画布：全屏唯一主舞台，全局件与其悬浮层都在其上 */}
      <div className="absolute inset-0" ref={canvasWrapRef}>
        {/* 画布右上全局件：真实保存状态 + 导出唯一入口（EditToolbar 不再重复） */}
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
          <span
            aria-live="polite"
            className="rounded-full bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400 backdrop-blur"
          >
            {saveStatus === "idle"
              ? null
              : saveStatus === "saving"
                ? "保存中…"
                : "已保存（本机）"}
          </span>
          <Button
            className="h-8 gap-1.5 bg-violet-500/90 px-3 text-xs text-white hover:bg-violet-500"
            disabled={!(dirty && selectedCanvasItem?.status === "image" && !!currentId) || exporting}
            onClick={() => void handleExport()}
            size="sm"
          >
            <DownloadIcon />
            {exporting ? "导出中…" : "导出"}
          </Button>
        </div>
        {/* 新结果提示：占位卡完成时结果不在视口内才浮出（在视口内静默），点击定位选中 */}
        {reveal ? (
          <button
            aria-live="polite"
            className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-100 shadow-lg hover:bg-zinc-800"
            onClick={handleRevealClick}
            type="button"
          >
            有新结果，点击查看
          </button>
        ) : null}
        <CanvasStage
          dispatch={dispatch}
          exportError={exportError}
          focus={focus}
          onRetryItem={retryItem}
          onResetEdits={handleResetEdits}
          state={canvas}
        />
        {/* 参考图上传失败：画布顶部内联提示，点按消失 */}
        {referenceError ? (
          <button
            className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md bg-red-500/15 px-3 py-1.5 text-xs text-red-300"
            onClick={() => setReferenceError(null)}
            type="button"
          >
            {referenceError}
          </button>
        ) : null}
        <input
          accept="image/*"
          aria-hidden
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadReference(file);
            e.target.value = "";
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>

      {/* 聊天收起后的重开入口：画布左上悬浮 */}
      {!chatOpen ? (
        <button
          aria-label="打开聊天"
          className="absolute left-4 top-4 z-30 flex size-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/90 text-zinc-100 shadow-lg hover:bg-zinc-800"
          onClick={() => setChatOpen(true)}
          type="button"
        >
          <MessageSquareIcon className="size-4" />
        </button>
      ) : null}

      {/* 聊天面板：md+ 为画布上方左上悬浮卡片（可收起）；<md 全屏互斥切换 */}
      <div
        className={
          chatOpen
            ? "absolute inset-0 z-40 flex md:inset-auto md:bottom-4 md:left-4 md:top-4 md:w-[340px] md:overflow-hidden md:rounded-xl md:border md:border-zinc-800/80 md:shadow-2xl md:shadow-black/40"
            : "hidden"
        }
        data-testid="chat-panel-container"
      >
        <ChatPanel
          agentIcon={sessionAgent?.icon}
          agentId={agentId}
          agentName={sessionAgent?.name}
          agents={agents}
          busy={busy}
          focusSignal={composerFocusNonce}
          hasSession={!!currentId}
          onCollapse={() => setChatOpen(false)}
          onRename={(title) => {
            if (currentId) void renameSession(currentId, title);
          }}
          {...(currentId ? { onAttach: () => fileInputRef.current?.click() } : {})}
          input={currentSlot?.draft ?? ""}
          messages={messages}
          onAgentChange={(id) => void handleAgentChange(id)}
          onInputChange={handleInputChange}
          onRemoveReference={() => dispatch({ type: "select", id: null })}
          onSelectAsset={handleFocusAsset}
          onSend={() => void send()}
          onStop={stopGeneration}
          reference={composerReference}
          selectedAssetId={selectedCanvasItem?.assetId ?? null}
        />
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
