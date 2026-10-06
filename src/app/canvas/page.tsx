"use client";

import { CanvasStage } from "@/components/canvas/canvas-stage";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/chat-panel";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { UserMenuContent } from "@/components/chat/user-menu";
import { composeEditedImage } from "@/lib/canvas/export-canvas";
import { DownloadIcon, MessageSquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { hasPendingHandoff, takePendingHandoffFiles } from "@/lib/chat/home-handoff";

/**
 * useSearchParams 需要客户端回退边界：静态预渲染期间由 Suspense 兜底。
 * 内部组件见 ChatPageInner。
 */
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

/** 每会话工作区槽：消息、输入草稿与进行中标记（引用即画布选中，不单独存槽）。 */
interface SessionSlot {
  messages: UIMessage[];
  draft: string;
  busy: boolean;
}

const EMPTY_SLOT: SessionSlot = { messages: [], draft: "", busy: false };

function ChatPageInner() {
  const t = useTranslations("canvas");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Record<string, SessionSlot>>({});
  // Agent 预选在下方 useSearchParams 处初始化（?agent=）
  const [canvas, dispatch] = useReducer(canvasReducer, initialCanvasState);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 工作台状态：聊天显隐（窄屏即聊天/画布切换）、会话抽屉。
  const [chatOpen, setChatOpen] = useState(true);
  // 头部时钟下拉（会话列表 + 用户区）：受控开关与搜索词。
  const [historyOpen, setHistoryOpen] = useState(false);
  // 输入框外部聚焦信号：新建会话后带回聊天框（nonce 变化触发聚焦一次）。
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [historyQuery, setHistoryQuery] = useState("");
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
  /** 会话绑定 Agent 的署名签名（画布条目徽标用；无匹配返回 undefined=无徽标）。 */
  const agentSigOf = useCallback(
    (agentIdStr: string | null | undefined) => {
      const a = agents.find((ag) => ag.id === agentIdStr);
      return a ? { agentIcon: a.icon, agentName: a.name } : undefined;
    },
    [agents],
  );

  const handleFocusAsset = useCallback(
    (assetId: string) => {
      const exists = canvas.items.some((i) => i.assetId === assetId);
      if (!exists) {
        const image = messages
          .flatMap((m) => m.parts)
          .find((p): p is Extract<UIMessage["parts"][number], { type: "image" }> =>
            p.type === "image" && p.assetId === assetId,
          );
        if (image) {
          const sig = agentSigOf(
            currentId ? sessions.find((s) => s.id === currentId)?.agentId : undefined,
          );
          dispatch({
            type: "addImageItems",
            images: [{ assetId: image.assetId, url: image.url, ...(sig ?? {}) }],
          });
        }
      }
      // 窄屏聊天/画布互斥：定位是明确的看图意图，自动切到画布视图。
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        setChatOpen(false);
      }
      setFocus({ assetId, nonce: Date.now() });
    },
    [canvas.items, messages, currentId, sessions, agentSigOf],
  );

  /** 从会话消息的图片 part 派生画布条目（幂等，按 assetId 去重；placeNew 排布）。 */
  const deriveImages = useCallback(
    (messages: UIMessage[], sig?: { agentIcon?: string; agentName?: string }) => {
      const images = messages.flatMap((m) =>
        m.parts.flatMap((p) =>
          p.type === "image" ? [{ assetId: p.assetId, url: p.url, ...(sig ?? {}) }] : [],
        ),
      );
      if (images.length) dispatch({ type: "addImageItems", images });
    },
    [],
  );

  // 参考图上传内核：/upload purpose=reference（绑会话资产、不写聊天消息）。直发衔接复用。
  const uploadReferenceTo = useCallback(
    async (sessionId: string, file: File): Promise<{ assetId: string; url: string }> => {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "reference");
      form.append("sessionId", sessionId);
      const res = await fetch("/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          err?.error?.message ?? t("page.referenceUploadFailedWithStatus", { status: res.status }),
        );
      }
      return (await res.json()) as { assetId: string; url: string };
    },
    [t],
  );
  // 参考图上传：上传后落画布并选中即引用（手动路径，错误以 chip 下方提示呈现）。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const uploadReference = useCallback(
    async (file: File) => {
      if (!currentId) return;
      setReferenceError(null);
      try {
        const data = await uploadReferenceTo(currentId, file);
        dispatch({
          type: "addImageItems",
          images: [{ assetId: data.assetId, url: data.url, name: file.name }],
          selectNew: true,
        });
      } catch (e) {
        setReferenceError(e instanceof Error ? e.message : t("page.referenceUploadFailed"));
      }
    },
    [currentId, t, uploadReferenceTo],
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

  const searchParams = useSearchParams();
  const agentParam = searchParams.get("agent");
  const draftParam = searchParams.get("draft");
  const sendParam = searchParams.get("send");
  // 直发去重 nonce（首页提交时间戳）：同文案连发两次时 draft 相同也能再次入队。
  const sendNonceParam = searchParams.get("t");
  // 直发意图：首渲染即判定，先于 loadSessions 的 bootstrap 引导读取。
  const directSendRef = useRef(sendParam === "1");
  // 直发衔接的新会话 id：newChat 建会话后置位，slot 落地（渲染提交）后由衔接 effect 消费。
  const directSendSessionRef = useRef<string | null>(null);
  // 刚由 newChat 创建的会话 id：其 selectSession 必须跳过——新会话无历史消息，
  // 且 loadMessages 异步回包会覆盖直发 runRound 乐观 append 的用户消息（竞态）。
  const justCreatedRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  // newChat 每渲染重建；loadSessions（deps []）经 ref 调用当次最新版本——
  // 直发衔接由 bootstrap 引导完成时触发建会话（B1）。
  const newChatRef = useRef<() => Promise<void>>(async () => {});
  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (!res.ok) return;
    const data = (await res.json()) as { sessions: SessionInfo[] };
    setSessions(data.sessions);
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      // 直发衔接：不切最近会话（spec/canvas-workspace「直发衔接进入」），
      // 引导完成后立即新建会话（newChat 为函数声明，运行时已提升、可前向调用；
      // 其用到的 setter/ref 与首渲染 agentId 初始化在此语境下均正确）。
      if (data.sessions[0] && !directSendRef.current) setCurrentId(data.sessions[0].id);
      else if (directSendRef.current) void newChatRef.current();
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
        throw new Error(err?.error?.message ?? t("page.exportFailedWithStatus", { status: res.status }));
      }
      await loadMessages(currentId);
      handleResetEdits();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : t("page.exportFailed"));
    } finally {
      setExporting(false);
    }
  }, [canvas, currentId, loadMessages, handleResetEdits, dirty, t]);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: AgentInfo[] }) => {
        setAgents(d.agents);
        // URL 预选的 Agent（首页 Agent 卡片跳转）仍有效时保留
        if (d.agents[0]) {
          setAgentId((prev) => (prev && d.agents.some((a) => a.id === prev) ? prev : d.agents[0].id));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
  }, [loadSessions]);

  // 首页创作输入带来的草稿（?draft=）与 Agent 预选（?agent=）。
  // 读 useSearchParams（路由状态）而非 window.location——SPA 跳转挂载时后者可能滞后。
  // 草稿消费点必须在 restoreWorkspace 之后（否则会被本机快照的旧草稿覆盖）：
  // selectSession/newChat 末尾消费；restore 在途或无会话时挂起，由下方 effect 兜底。
  const [agentId, setAgentId] = useState<string>(agentParam ?? "");
  const pendingDraftRef = useRef<string | null>(null);
  const queuedDraftParamRef = useRef<string | null>(null);
  const queuedSendNonceRef = useRef<string | null>(null);
  // 直发衔接状态行（聊天面板展示）；null 即非衔接中。
  const [directSendStatus, setDirectSendStatus] = useState<{
    text: string;
    tone: "progress" | "error";
  } | null>(null);
  useEffect(() => {
    // 入队：同值不重复（地址栏清理后路由状态归零，不会再触发）；
    // nonce 变化视为新一次直发（同文案连发场景）。
    if (
      draftParam &&
      (queuedDraftParamRef.current !== draftParam || sendNonceParam !== queuedSendNonceRef.current)
    ) {
      queuedDraftParamRef.current = draftParam;
      queuedSendNonceRef.current = sendNonceParam;
      pendingDraftRef.current = draftParam;
      // 直发意图需 handoff 暂存仍在：跳转后刷新会清空模块内存，此时降级为草稿回填
      // 不直发（spec/canvas-workspace「刷新丢附件保草稿」）。
      directSendRef.current = sendParam === "1" && hasPendingHandoff();
      if (directSendRef.current) {
        setDirectSendStatus({ text: t("page.directSend.creatingSession"), tone: "progress" });
      }
    }
    if (agentParam) {
      setAgentId(agentParam);
    }
  }, [draftParam, agentParam, sendParam, sendNonceParam, t]);
  function applyPendingDraft(id: string) {
    const draft = pendingDraftRef.current;
    if (!draft) return;
    pendingDraftRef.current = null;
    updateSlot(id, (slot) => ({ ...slot, draft }));
    setComposerFocusNonce((n) => n + 1);
  }
  // 兜底消费：实例复用（无新 selectSession）或 restore 完成后仍未消费的草稿；
  // 直发衔接中草稿由 runDirectSend 接管，兜底不抢（否则草稿被填入输入框且直发丢字）。
  useEffect(() => {
    if (!currentId || restoredForRef.current !== currentId) return;
    if (directSendRef.current) return;
    applyPendingDraft(currentId);
    // applyPendingDraft 每渲染重建；以 currentId 为触发源即可（draft 经 ref 传递）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  // 直发衔接消费：新会话 slot 在渲染中落地后执行上传与自动发送（spec「直发衔接进入」）。
  useEffect(() => {
    const id = directSendSessionRef.current;
    if (!id || currentId !== id || !slots[id]) return;
    directSendSessionRef.current = null;
    void runDirectSend(id);
    // runDirectSend 每渲染重建，此处闭包取当次渲染版本（slots 已含新会话 slot）；
    // 以 currentId/slots 为触发源（草稿/附件经 ref 与 handoff store 传递）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, slots]);
  // 消费后清理地址栏参数，避免刷新重复回填（replaceState 与路由状态同步）
  useEffect(() => {
    if (draftParam || agentParam) window.history.replaceState(null, "", "/canvas");
  }, [draftParam, agentParam]);

  useEffect(() => {
    if (!currentId) return;
    if (justCreatedRef.current === currentId) {
      justCreatedRef.current = null;
      return;
    }
    void selectSession(currentId);
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
    // 会话图片统一署名为该会话绑定的 Agent
    const sig = agentSigOf(sessions.find((s) => s.id === id)?.agentId);
    if (cached?.busy) {
      deriveImages(cached.messages, sig);
      restoreWorkspace(id);
      return;
    }
    const msgs = await loadMessages(id);
    deriveImages(msgs, sig);
    restoreWorkspace(id);
    applyPendingDraft(id);
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
      justCreatedRef.current = data.id;
      setCurrentId(data.id);
      setAgentId(data.agentId ?? agentId);
      // 新建会话转到聊天框：关下拉、展开聊天面板并聚焦输入框。
      setHistoryOpen(false);
      setChatOpen(true);
      setComposerFocusNonce((n) => n + 1);
      if (directSendRef.current) {
        // 衔接接管：置位新会话 id，待 slot 在渲染中落地后由衔接 effect 执行上传+直发。
        // 不在此同步调 runDirectSend——runRound 读取当次渲染的 slots 闭包，
        // state 提交前调用会读到陈旧 slots 而静默空转（code review B2）。
        directSendSessionRef.current = data.id;
        return;
      }
      applyPendingDraft(data.id);
    } else if (directSendRef.current) {
      // 注意：不预先清 pendingDraftRef——无会话可回填时需保留排队供「新会话」重试。
      const text = pendingDraftRef.current ?? "";
      await recoverDirectSendFailure(text);
    }
  }
  newChatRef.current = newChat;

  /**
   * 直发衔接：消费 ?draft&send=1 —— 附件并行上传（任一失败即不发送，已成功的
   * 仍落画布，草稿回填），随后以 assetId 显式为引用自动发送首轮（不依赖选中态，
   * spec/canvas-workspace「直发衔接进入」）。
   */
  async function runDirectSend(sessionId: string) {
    const text = pendingDraftRef.current ?? "";
    pendingDraftRef.current = null;
    directSendRef.current = false;
    const files = takePendingHandoffFiles();
    try {
      let refs: string[] = [];
      if (files.length) {
        setDirectSendStatus({
          text: t("page.directSend.uploadingAttachments", { done: 0, total: files.length }),
          tone: "progress",
        });
        let done = 0;
        const settled = await Promise.allSettled(
          files.map(async (file) => {
            const data = await uploadReferenceTo(sessionId, file);
            done += 1;
            setDirectSendStatus({
              text: t("page.directSend.uploadingAttachments", { done, total: files.length }),
              tone: "progress",
            });
            return { ...data, name: file.name };
          }),
        );
        const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
        if (ok.length < files.length) {
          // 原子性：任一失败即不发送；已成功条目仍落画布（可见可复用），草稿回填。
          if (ok.length) {
            dispatch({
              type: "addImageItems",
              images: ok.map((v) => ({ assetId: v.assetId, url: v.url, name: v.name })),
            });
          }
          updateSlot(sessionId, (slot) => ({ ...slot, draft: text }));
          setComposerFocusNonce((n) => n + 1);
          setDirectSendStatus({
            text: t("page.directSend.attachmentsFailed", { failed: files.length - ok.length }),
            tone: "error",
          });
          return;
        }
        dispatch({
          type: "addImageItems",
          images: ok.map((v) => ({ assetId: v.assetId, url: v.url, name: v.name })),
        });
        refs = ok.map((v) => v.assetId);
      }
      setDirectSendStatus({ text: t("page.directSend.sending"), tone: "progress" });
      await runRound(sessionId, text, refs);
      setDirectSendStatus(null);
    } catch (e) {
      // 上传/发送环节异常：文案回填不丢字。
      updateSlot(sessionId, (slot) => ({ ...slot, draft: text }));
      setComposerFocusNonce((n) => n + 1);
      setDirectSendStatus({
        text: e instanceof Error ? e.message : t("page.directSend.failedDraftRestored"),
        tone: "error",
      });
    }
  }

  /** 直发建会话失败：退回常规入口（引导最近会话）并回填草稿；无任何会话时保留排队待重试。 */
  async function recoverDirectSendFailure(text: string) {
    directSendRef.current = false;
    setDirectSendStatus(null);
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
      const first = data.sessions[0];
      if (first) {
        pendingDraftRef.current = null;
        bootstrappedRef.current = true;
        await selectSession(first.id);
        updateSlot(first.id, (slot) => ({ ...slot, draft: text }));
        setComposerFocusNonce((n) => n + 1);
        setDirectSendStatus({
          text: t("page.directSend.sessionCreateFailedRestored"),
          tone: "error",
        });
        return;
      }
    }
    // 无会话可回填（如首次使用）：草稿留在队列，点「新会话」即按常规路径消费。
    pendingDraftRef.current = text;
    setDirectSendStatus({
      text: t("page.directSend.sessionCreateFailedQueued"),
      tone: "error",
    });
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
      setActionError(t("page.renameFailed"));
    }
  }

  /** 删除会话：服务端同步清理资产；删除当前会话后切换到相邻会话或空态。 */
  async function deleteSession(id: string) {
    setActionError(null);
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setActionError(t("page.deleteFailed"));
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
      setActionError(t("page.agentSwitchFailed"));
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
            const sig = agentSigOf(currentSession?.agentId ?? agentId);
            dispatch({
              type: "addPlaceholder",
              id: event.id,
              referenceAssetId:
                typeof args.referenceAssetId === "string" && args.referenceAssetId
                  ? args.referenceAssetId
                  : roundRefs[0],
              prompt: typeof args.prompt === "string" ? args.prompt : undefined,
              ...(sig ?? {}),
            });
          }
          updateAssistant((parts) => [
            ...parts,
            {
              type: "tool_status",
              id: event.id,
              label:
                event.name === "generate_image"
                  ? t("page.toolStatus.generateImage")
                  : t("page.toolStatus.running", { name: event.name }),
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
                  errorMessage: String(event.details?.message ?? t("stage.failed")),
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
          appendText(`\n${t("page.errorLine", { message: event.message })}`);
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
        appendText(`\n${t("page.stoppedLine")}`);
        if (currentIdRef.current === sessionId) {
          for (const pid of roundPlaceholders) {
            const item = canvasStateRef.current.items.find((i) => i.id === pid);
            if (item?.status === "generating") dispatch({ type: "removeItem", id: pid });
          }
        }
      } else {
        // 网络/流中断：聊天侧补错误行，画布侧未结算占位卡置失败（服务端回合可能已完成，切回会话时以服务器为准）。
        appendText(`\n${t("page.errorLine", { message: t("page.connectionLost") })}`);
        failPendingPlaceholders(sessionId, t("page.connectionLostCanvas"));
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
    // 手动发送接管对话流后，旧的直发衔接状态行（如残留错误）不再有信息量，一并清理。
    setDirectSendStatus(null);
    await runRound(sessionId, text, roundRefs);
  }

  /** 失败占位卡重试：以卡内保存的原始意图（prompt + 原引用）重新发起一轮。 */
  function retryItem(item: CanvasItem) {
    if (!currentId || busy) return;
    const text = item.prompt
      ? t("page.regenerate", { prompt: item.prompt })
      : t("page.regenerateLast");
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
      ? {
          assetId: selectedCanvasItem.assetId,
          name: selectedCanvasItem.name ?? t("page.canvasImageName"),
        }
      : null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      {/* 画布：全屏唯一主舞台，全局件与其悬浮层都在其上（入场淡入，motion-reduce 降级） */}
      <div
        className="absolute inset-0 motion-reduce:animate-none animate-in fade-in duration-500"
        ref={canvasWrapRef}
      >
        {/* 画布右上全局件：真实保存状态 + 导出唯一入口（EditToolbar 不再重复） */}
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
          <span
            aria-live="polite"
            className="rounded-full bg-popover/80 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur"
          >
            {saveStatus === "idle"
              ? null
              : saveStatus === "saving"
                ? t("page.saving")
                : t("page.savedLocal")}
          </span>
          <Button
            className="h-8 gap-1.5 bg-violet-500/90 px-3 text-xs text-white hover:bg-violet-500"
            disabled={!(dirty && selectedCanvasItem?.status === "image" && !!currentId) || exporting}
            onClick={() => void handleExport()}
            size="sm"
          >
            <DownloadIcon />
            {exporting ? t("page.exporting") : t("page.export")}
          </Button>
        </div>
        {/* 新结果提示：占位卡完成时结果不在视口内才浮出（在视口内静默），点击定位选中 */}
        {reveal ? (
          <button
            aria-live="polite"
            className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-popover/90 px-3 py-1.5 text-xs text-foreground shadow-lg hover:bg-accent"
            onClick={handleRevealClick}
            type="button"
          >
            {t("page.revealResult")}
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
          aria-label={t("page.openChat")}
          className="absolute left-4 top-4 z-30 flex size-10 items-center justify-center rounded-full border border-border bg-popover/90 text-foreground shadow-lg hover:bg-accent"
          onClick={() => setChatOpen(true)}
          type="button"
        >
          <MessageSquareIcon className="size-4" />
        </button>
      ) : null}

      {/* 聊天面板：md+ 为画布上方左上悬浮卡片（可收起）；<md 全屏互斥切换。
          入场动效（Level 1）：自左滑入+缩放+淡入；hidden（display:none）切换会重启动画，
          收起再展开会重播——已拍板接受（design.md D5）。仅 transform/opacity，GPU 合成。 */}
      <div
        className={
          chatOpen
            ? "absolute inset-0 z-40 flex motion-reduce:animate-none animate-in fade-in slide-in-from-left-4 zoom-in-[0.98] duration-300 ease-out md:inset-auto md:bottom-4 md:left-4 md:top-4 md:w-[340px] md:overflow-hidden md:rounded-xl md:border md:border-border/80 md:shadow-2xl md:shadow-black/40"
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
          historyContent={
            <div className="flex h-[420px] flex-col overflow-hidden">
              <div className="min-h-0 flex-1">
                <SessionSidebar
                  agents={agents}
                  currentId={currentId}
                  errorMessage={actionError}
                  onDeleteSession={(id) => void deleteSession(id)}
                  onCollapse={() => setHistoryOpen(false)}
                  onNewChat={() => void newChat()}
                  onQueryChange={setHistoryQuery}
                  onRenameSession={(id, title) => void renameSession(id, title)}
                  onSelectSession={(id) => {
                    setHistoryOpen(false);
                    void selectSession(id);
                  }}
                  query={historyQuery}
                  sessions={sessions}
                />
              </div>
              {/* 用户区：无会话空态下用户入口仍可达（时钟下拉常开） */}
              <div className="shrink-0 border-t border-border bg-background p-1">
                <UserMenuContent />
              </div>
            </div>
          }
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
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
          statusLine={directSendStatus}
          sessionTitle={sessions.find((s) => s.id === currentId)?.title ?? ""}
        />
      </div>

    </main>
  );
}
