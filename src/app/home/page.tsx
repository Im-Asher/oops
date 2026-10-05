"use client";

import { Composer } from "@/components/chat/composer";
import { ThemeToggle } from "@/components/theme-provider";
import { UserMenu } from "@/components/chat/user-menu";
import {
  ImageIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  PaletteIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { setPendingHandoffFiles } from "@/lib/chat/home-handoff";
import { APP_VERSION } from "@/lib/version";
import type { AgentInfo } from "@/types/chat";

/** 单个待传附件（id 供 chip 移除定位，自增序号即唯一）。 */
interface HomePendingFile {
  id: string;
  file: File;
}

/** 侧栏导航项：可用项为链接，禁用项仅展示（本版未实现的能力）。 */
function NavItem({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active?: boolean;
}) {
  const disabled = !href;
  const className = `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
    active
      ? "bg-muted text-foreground"
      : disabled
        ? "cursor-not-allowed text-muted-foreground/50"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
  }`;
  if (disabled) {
    return (
      <button aria-disabled className={className} disabled title="敬请期待" type="button">
        <Icon className="size-4 shrink-0" />
        {label}
      </button>
    );
  }
  return (
    <Link className={className} href={href}>
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

/**
 * 首页落地页（spec/home-landing）：左侧栏（首页/创建分组/用户入口）+ 垂直居中的
 * 创作横幅与完整创作 composer（Agent 选择/附件）。提交即直发：跳 /canvas 后
 * 由画布侧新建会话并自动发送（含附件为参考图）。
 */
export default function HomePage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState("");
  // 待传附件：首页仅内存暂存，跳转建会话后由画布侧真实上传（home-handoff store）。
  const [files, setFiles] = useState<HomePendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  // 直发乐观态：按钮转圈 + 输入卡弱化 + 路由锁（跳转期间不可再触发）。
  const [submitting, setSubmitting] = useState(false);
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
      if (nonImage > 0) parts.push(`仅支持图片，${nonImage} 个文件未添加`);
      if (overflow > 0) parts.push(`最多 5 个附件，超出 ${overflow} 个未添加`);
      setFileError(parts.join("；"));
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
      {/* 左侧栏：首页 / 创建分组（AI画布可用，创建设计置灰）/ 其他导航项置灰 / 底部用户入口 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4">
        <div className="flex items-center gap-2 px-3 pb-4">
          <span className="text-base font-semibold tracking-wide text-foreground">oops</span>
          <span
            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            data-testid="app-version-badge"
            title={`构建版本 ${APP_VERSION}`}
          >
            v{APP_VERSION}
          </span>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1" aria-label="主导航">
          <NavItem active href="/home" icon={LayoutDashboardIcon} label="首页" />
          <p className="px-3 pb-1 pt-4 text-xs text-muted-foreground/80">创建</p>
          <NavItem href="/canvas" icon={SparklesIcon} label="AI 画布" />
          <NavItem icon={PaletteIcon} label="创建设计" />
          <p className="px-3 pb-1 pt-4 text-xs text-muted-foreground/80">库</p>
          <NavItem icon={ImageIcon} label="作品集" />
          <NavItem icon={ImagesIcon} label="素材库" />
          <NavItem icon={MessageSquareIcon} label="消息中心" />
        </nav>
        <div className="flex items-center gap-1 border-t border-border pt-3">
          <NavItem icon={SettingsIcon} label="设置" />
          <div className="ml-auto flex items-center gap-0.5 pr-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </aside>

      {/* 主区：创作横幅 + 创作输入框（垂直居中） */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-10 px-6 py-16">
          <section className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-3xl font-semibold text-foreground">用一句话，生成电商好图</h1>
            <p className="text-sm text-muted-foreground">
              描述你的商品与场景，AI 画布替你完成主图、详情与氛围图。
            </p>
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
              <p className="mt-2 px-1 text-xs text-red-500" data-testid="home-file-error" role="alert">
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
      </div>
    </main>
  );
}
