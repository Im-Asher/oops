"use client";

/**
 * 画布页悬浮顶栏（spec/canvas-workspace「AI 画布页布局」）：浮于画布之上、不占布局、
 * 不改变画布视角，承载返回首页与画布全局件（保存状态、导出、积分余额、头像菜单）。
 * 容器 pointer-events-none —— 顶栏空白区必须放行画布拖拽，仅控件本身可交互。
 */
import { UserMenu } from "@/components/chat/user-menu";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, CoinsIcon, DownloadIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-provider";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";

interface AppHeaderProps {
  /** 本机保存状态文案（空串/缺省 = 不展示）。 */
  saveLabel?: string;
  /** 导出按钮文案（页面层按导出中/空闲翻译）。 */
  exportLabel: string;
  exportDisabled?: boolean;
  onExport: () => void;
}

export function AppHeader({ saveLabel, exportLabel, exportDisabled, onExport }: AppHeaderProps) {
  const t = useTranslations("canvas.appHeader");
  // 余额徽标（credits spec）：挂载拉取一次 profile；任务结算后刷新页面更新。
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { creditBalance?: number } | null) => {
        if (!cancelled && d && typeof d.creditBalance === "number") {
          setCreditBalance(d.creditBalance);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-50 flex items-center justify-between gap-2 md:inset-x-4 md:top-4">
      <Link
        aria-label={t("backToHome")}
        className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full border border-border bg-popover/90 px-3 text-sm text-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent"
        href="/home"
      >
        <ArrowLeftIcon className="size-4" />
        <span className="hidden sm:inline">{t("backToHome")}</span>
      </Link>
      <div className="pointer-events-auto flex items-center gap-2">
        {saveLabel ? (
          <span
            aria-live="polite"
            className="hidden rounded-full bg-popover/90 px-2.5 py-1 text-xs text-muted-foreground shadow-lg backdrop-blur md:inline"
          >
            {saveLabel}
          </span>
        ) : null}
        <Button
          className="h-8 gap-1.5 bg-primary px-3 text-xs hover:bg-primary/90"
          disabled={exportDisabled}
          onClick={onExport}
          size="sm"
        >
          <DownloadIcon />
          {exportLabel}
        </Button>
        <ThemeToggle className="size-6 text-muted-foreground hover:text-foreground" />
        <span
          aria-label={t("balance")}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-popover/90 px-2.5 text-xs tabular-nums text-foreground shadow-lg backdrop-blur"
          data-testid="app-header-credits"
          title={t("balance")}
        >
          <CoinsIcon className="size-3.5" />
          {creditBalance ?? "—"}
        </span>
        <span className="flex size-10 items-center justify-center rounded-full bg-popover/90 shadow-lg backdrop-blur">
          <UserMenu />
        </span>
      </div>
    </div>
  );
}
