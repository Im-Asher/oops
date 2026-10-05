"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-provider";
import { UserMenu } from "@/components/chat/user-menu";
import {
  ArrowUpIcon,
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
import { useEffect, useState, type ComponentType } from "react";
import type { AgentInfo } from "@/types/chat";

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
 * 首页落地页（spec/home-landing）：左侧栏（首页/创建分组/用户入口）+ 创作横幅、
 * 创作输入框与 Agent 卡片。提交携带草稿跳 /canvas 填入不直发；Agent 卡片跳转预选。
 */
export default function HomePage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: AgentInfo[] }) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  /** 提交创作输入：仅携带草稿跳转，画布侧填入输入框聚焦、不自动发送。 */
  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    router.push(`/canvas?draft=${encodeURIComponent(text)}`);
  }

  return (
    <main className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      {/* 左侧栏：首页 / 创建分组（AI画布可用，创建设计置灰）/ 其他导航项置灰 / 底部用户入口 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4">
        <div className="px-3 pb-4 text-base font-semibold tracking-wide text-foreground">oops</div>
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

      {/* 主区：创作横幅 + 创作输入框 + Agent 卡片 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16">
          <section className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-3xl font-semibold text-foreground">用一句话，生成电商好图</h1>
            <p className="text-sm text-muted-foreground">
              描述你的商品与场景，AI 画布替你完成主图、详情与氛围图。
            </p>
          </section>

          <section>
            <div className="rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring">
              <Textarea
                aria-label="创作输入"
                className="max-h-40 min-h-16 resize-none border-0 bg-transparent px-2 text-sm text-foreground focus-visible:ring-0"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder="描述你的设计需求…（例如：为这款保温杯拍一张纯白背景主图）"
                value={draft}
              />
              <div className="flex justify-end px-1 pb-1">
                <Button
                  aria-label="去画布生成"
                  className="size-8 rounded-full bg-violet-500/90 hover:bg-violet-500"
                  disabled={!draft.trim()}
                  onClick={submitDraft}
                  size="icon-sm"
                >
                  <ArrowUpIcon />
                </Button>
              </div>
            </div>
            <p className="mt-2 px-1 text-xs text-muted-foreground/80">回车跳转 AI 画布，草稿会自动填入输入框。</p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-foreground/80">选择一个专属 Agent</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <button
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-ring"
                  key={agent.id}
                  onClick={() => router.push(`/canvas?agent=${encodeURIComponent(agent.id)}`)}
                  type="button"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-lg"
                  >
                    {agent.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{agent.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {agent.description}
                    </span>
                  </span>
                </button>
              ))}
              {!agents.length ? (
                <p className="col-span-full text-xs text-muted-foreground/80">Agent 列表加载中…</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
