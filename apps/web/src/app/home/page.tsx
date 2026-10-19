"use client";

import { Composer } from "@/components/chat/composer";
import { PresetDialog } from "@/components/design/preset-dialog";
import { HomeSidebar, type HomeView } from "@/components/layout/home-sidebar";
import { NotificationsPanel } from "@/components/notifications/notifications-panel";
import { PortfolioPanel } from "@/components/portfolio/portfolio-panel";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setPendingHandoffFiles } from "@/lib/chat/home-handoff";
import { useNotifications } from "@/lib/notifications/use-notifications";
import type { AgentInfo } from "@/types/chat";

/** 单个待传附件（id 供 chip 移除定位，自增序号即唯一）。 */
interface HomePendingFile {
  id: string;
  file: File;
}

/**
 * 首页落地页（spec/home-landing）：左侧两级栏（首页 / 创作 / 图库 + 二级项）+ 垂直居中的
 * 创作横幅与完整创作 composer（Agent 选择/附件）。提交即直发：跳 /canvas 后
 * 由画布侧新建会话并自动发送（含附件为参考图）。
 */
export default function HomePage() {
  const t = useTranslations("home");
  const tn = useTranslations("notifications");
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState("");
  // 待传附件：首页仅内存暂存，跳转建会话后由画布侧真实上传（home-handoff store）。
  const [files, setFiles] = useState<HomePendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  // 直发乐观态：按钮转圈 + 输入卡弱化 + 路由锁（跳转期间不可再触发）。
  const [submitting, setSubmitting] = useState(false);
  // 排版设计：尺寸前置设置弹窗（人工海报编辑器入口）。
  const [designDialogOpen, setDesignDialogOpen] = useState(false);
  /** 主区视图：创作落地页 / 作品集 / 消息中心。后两者不占独立路由，侧栏切换即可（D10）。
   *  消息中心在导航树里没有条目 —— 唯一入口是侧栏底栏铃铛，由它切到这里。 */
  const [view, setView] = useState<HomeView>("home");
  // 铃铛与消息中心共用同一份取数状态：挂一次 hook、只跑一个 60s 轮询（D11）
  const notifications = useNotifications((k) => tn(k));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextFileIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: AgentInfo[] }) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  /**
   * 提交直发：携带文本 + Agent（空 = 服务端默认）+ send 标记跳转，附件经
   * handoff store 交给画布侧上传；nonce 保证同文案连发也能再次触发衔接。
   */
  function submitDirect() {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setPendingHandoffFiles(files.map((f) => f.file));
    const params = new URLSearchParams({ draft: text, send: "1", t: String(Date.now()) });
    if (agentId) params.set("agent", agentId);
    router.push(`/canvas?${params.toString()}`);
  }

  /** 附件校验：仅图片、至多 5 个；违规部分拒绝并提示（不中断已合法部分的添加）。 */
  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    const images = picked.filter((f) => f.type.startsWith("image/"));
    const nonImage = picked.length - images.length;
    const room = Math.max(0, 5 - files.length);
    const accepted = images.slice(0, room);
    const overflow = images.length - accepted.length;
    if (nonImage > 0 || overflow > 0) {
      const parts: string[] = [];
      if (nonImage > 0) parts.push(t("fileErrorNonImage", { count: nonImage }));
      if (overflow > 0) parts.push(t("fileErrorOverflow", { count: overflow }));
      setFileError(parts.join(t("fileErrorSeparator")));
    } else {
      setFileError(null);
    }
    if (accepted.length) {
      setFiles((prev) => [
        ...prev,
        ...accepted.map((file) => ({ file, id: `f${++nextFileIdRef.current}` })),
      ]);
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setFileError(null);
  }

  return (
    <main className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      {/* 左侧两级栏：一级项 首页 / 创作 / 图库，二级项随所属组展开；
          折叠/抽屉/展开态由侧栏内部持有，故此处切换侧栏不会重渲染主区。 */}
      <HomeSidebar
        notifications={notifications}
        onOpenDesign={() => setDesignDialogOpen(true)}
        onViewChange={setView}
        view={view}
      />

      {/* 主区：作品集 / 消息中心视图，或创作落地页（横幅 + 输入框，垂直居中） */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {view === "portfolio" ? (
          <PortfolioPanel />
        ) : view === "messages" ? (
          <NotificationsPanel feed={notifications} />
        ) : (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-10 px-6 py-16">
            <section className="flex flex-col items-center gap-3 text-center">
              <h1 className="text-3xl font-semibold text-foreground">{t("headline")}</h1>
              <p className="text-sm text-muted-foreground">{t("subheadline")}</p>
            </section>

            <section>
              <div
                className={
                  submitting
                    ? "scale-[0.99] opacity-60 transition-all duration-200"
                    : "transition-all duration-200"
                }
              >
                <Composer
                  agents={agents}
                  agentId={agentId}
                  busy={submitting}
                  hasSession={false}
                  onChange={setDraft}
                  onAgentChange={setAgentId}
                  onAttach={() => fileInputRef.current?.click()}
                  onRemovePendingFile={removeFile}
                  onSend={submitDirect}
                  pendingFiles={files.map((f) => ({ id: f.id, name: f.file.name }))}
                  value={draft}
                  variant="landing"
                />
              </div>
              {fileError ? (
                <p
                  className="mt-2 px-1 text-xs text-red-500"
                  data-testid="home-file-error"
                  role="alert"
                >
                  {fileError}
                </p>
              ) : null}
              <input
                accept="image/*"
                aria-hidden
                className="hidden"
                multiple
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
            </section>
          </div>
        )}
      </div>

      <PresetDialog onOpenChange={setDesignDialogOpen} open={designDialogOpen} />
    </main>
  );
}
