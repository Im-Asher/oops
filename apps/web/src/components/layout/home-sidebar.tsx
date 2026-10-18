"use client";

/**
 * /home 应用侧栏（spec home-landing「侧栏折叠态」，docs/DESIGN.md B7.2）。
 *
 * 形态取自 Canva 首页侧栏：导航项一律「图标在上、文字在下」竖排堆叠，展开态与
 * 折叠态共用同一个组件，切换只改 <aside> 的宽度——因此收起是一次单元素 width
 * 过渡，导航项不会在动画中重排。
 *
 * 折叠态保留文字标签（B7.2.4）：64px 轨减去内边距仍容得下四个中文字，可见文本
 * 因此能与 aria-label 一致，不留「只能靠 tooltip 理解」的无障碍缺口。
 *
 * 纯展示组件：不碰 view 状态、不碰路由、不取数——这些由 page.tsx 持有并下发，
 * 折叠因此只重渲染侧栏子树，主区不参与。
 */
import { LocaleToggle } from "@/components/locale-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-provider";
import { UserMenu } from "@/components/chat/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetCloseButton, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSidebarCollapse } from "@/lib/layout/use-sidebar-collapse";
import type { NotificationsFeed } from "@/lib/notifications/use-notifications";
import { APP_VERSION } from "@/lib/version";
import {
  ImageIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  MenuIcon,
  MessageSquareIcon,
  PaletteIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

export type HomeView = "home" | "portfolio" | "messages";

/** 字面量联合而非 string：typed messages 下 t() 只接受已知键。 */
type NavLabelKey =
  | "navHome"
  | "navCanvas"
  | "navCreateDesign"
  | "navPortfolio"
  | "navAssets"
  | "navMessages"
  | "navSettings";
type GroupLabelKey = "groupCreate" | "groupLibrary";

interface NavEntry {
  id: string;
  icon: ComponentType<{ className?: string }>;
  labelKey: NavLabelKey;
  /** 色相（B7.2.3）：创建组走品牌紫，库组走中性，视觉权重低于创建组 */
  tone: "brand" | "neutral";
  href?: string;
  /** 切主区视图的目标；存在即代表该项在某视图下为当前项 */
  view?: HomeView;
  /** 打开尺寸前置设置弹窗（创建设计） */
  opensDesign?: boolean;
  disabled?: boolean;
}

interface NavGroup {
  labelKey?: GroupLabelKey;
  entries: NavEntry[];
}

const MESSAGES_ENTRY: NavEntry = {
  icon: MessageSquareIcon,
  id: "messages",
  labelKey: "navMessages",
  tone: "neutral",
  view: "messages",
};

const NAV_GROUPS: NavGroup[] = [
  {
    entries: [
      {
        icon: LayoutDashboardIcon,
        id: "home",
        labelKey: "navHome",
        tone: "brand",
        view: "home",
      },
    ],
  },
  {
    entries: [
      { href: "/canvas", icon: SparklesIcon, id: "canvas", labelKey: "navCanvas", tone: "brand" },
      {
        icon: PaletteIcon,
        id: "create-design",
        labelKey: "navCreateDesign",
        opensDesign: true,
        tone: "brand",
      },
    ],
    labelKey: "groupCreate",
  },
  {
    entries: [
      {
        icon: ImageIcon,
        id: "portfolio",
        labelKey: "navPortfolio",
        tone: "neutral",
        view: "portfolio",
      },
      { disabled: true, icon: ImagesIcon, id: "assets", labelKey: "navAssets", tone: "neutral" },
      MESSAGES_ENTRY,
    ],
    labelKey: "groupLibrary",
  },
];

/** 侧栏折叠/展开钮；文案来自 home.* 词典。 */
function SidebarToggle({ action, onClick }: { action: "collapse" | "expand"; onClick: () => void }) {
  const t = useTranslations("home");
  const label = action === "collapse" ? t("collapseSidebar") : t("expandSidebar");
  const Icon = action === "collapse" ? PanelLeftCloseIcon : PanelLeftOpenIcon;
  return (
    <Button
      aria-label={label}
      data-testid="sidebar-collapse-toggle"
      onClick={onClick}
      size="icon-sm"
      title={label}
      variant="ghost"
    >
      <Icon />
    </Button>
  );
}

/**
 * 单个导航项：32px 方块图标 + 下方标签。折叠态与展开态共用，仅标签字号差一档，
 * 这样切换时不需要两套 DOM（也就没有重排与两套 aria 名称要维护）。
 */
function NavTile({
  active,
  collapsed,
  disabled,
  href,
  icon: Icon,
  label,
  onActivate,
  testId,
  tone,
}: {
  active: boolean;
  collapsed: boolean;
  disabled: boolean;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onActivate: () => void;
  testId: string;
  tone: "brand" | "neutral";
}) {
  const t = useTranslations("home");
  const shell = cn(
    "flex w-full flex-col items-center gap-1 rounded-lg px-1 outline-none transition-colors duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-ring/50",
    // 垂直预算（B7.2.2）：窄轨与面板的项高不同，否则 7 项 + footer 在矮视口必然溢出
    collapsed ? "py-0.5" : "py-1",
    disabled ? "cursor-not-allowed opacity-40" : active ? "" : "hover:bg-accent/50",
  );
  const content = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--duration-fast)]",
          active
            ? "bg-primary text-primary-foreground"
            : tone === "brand"
              ? "bg-brand-violet-500/12 text-brand-violet-700 dark:text-brand-violet-300"
              : "bg-sidebar-accent text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span
        className={cn(
          // 窄轨内 4 个中文字约 40px，44px 可用宽度足够，故一律不截断（B7.2.2）
          "whitespace-nowrap",
          collapsed ? "text-[10px] leading-none" : "text-[11px] leading-tight",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </>
  );

  if (disabled) {
    return (
      <button
        aria-disabled
        className={shell}
        data-testid={testId}
        disabled
        title={t("comingSoon")}
        type="button"
      >
        {content}
      </button>
    );
  }
  if (href) {
    return (
      <Link className={shell} data-testid={testId} href={href}>
        {content}
      </Link>
    );
  }
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={shell}
      data-testid={testId}
      onClick={onActivate}
      type="button"
    >
      {content}
    </button>
  );
}

function SidebarBody({
  collapsed,
  notifications,
  onActivate,
  onToggleCollapse,
  view,
}: {
  collapsed: boolean;
  notifications: NotificationsFeed;
  onActivate: (entry: NavEntry) => void;
  /** 抽屉态不传：该形态由 Sheet 的关闭钮承担显隐 */
  onToggleCollapse?: () => void;
  view: HomeView;
}) {
  const t = useTranslations("home");
  return (
    <div className="flex min-h-0 flex-1 flex-col px-1.5 py-2">
      {collapsed ? (
        <div className="flex justify-center pb-2">
          {onToggleCollapse ? <SidebarToggle action="expand" onClick={onToggleCollapse} /> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 pb-2">
          <span className="text-base font-semibold tracking-wide text-foreground">oops</span>
          <span
            className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary"
            data-testid="app-version-badge"
            title={t("buildVersion", { version: APP_VERSION })}
          >
            v{APP_VERSION}
          </span>
          {onToggleCollapse ? (
            <span className="ml-auto">
              <SidebarToggle action="collapse" onClick={onToggleCollapse} />
            </span>
          ) : null}
        </div>
      )}

      <nav
        aria-label={t("mainNav")}
        className="sidebar-scroll flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {NAV_GROUPS.map((group, index) => (
          <div key={group.labelKey ?? `group-${index}`}>
            {group.labelKey ? (
              collapsed ? (
                <div
                  aria-hidden
                  className="mx-auto my-2 h-px w-8 bg-brand-ink-200 dark:bg-brand-ink-800"
                />
              ) : (
                // 两侧发丝线 + 小字距标题：11px 居中裸文字与导航项标签几乎同形，
                // 少了分隔就分不出「创建组」与「库组」（B7.2.2）
                <div className="mt-2 mb-1 flex items-center gap-1.5 px-0.5">
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-brand-ink-200 dark:bg-brand-ink-800"
                  />
                  <span className="text-[10px] leading-none tracking-[0.08em] text-muted-foreground/70">
                    {t(group.labelKey)}
                  </span>
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-brand-ink-200 dark:bg-brand-ink-800"
                  />
                </div>
              )
            ) : null}
            <div className="flex flex-col gap-0.5">
              {group.entries.map((entry) => (
                <NavTile
                  active={entry.view === view}
                  collapsed={collapsed}
                  disabled={entry.disabled ?? false}
                  href={entry.href}
                  icon={entry.icon}
                  key={entry.id}
                  label={t(entry.labelKey)}
                  onActivate={() => onActivate(entry)}
                  testId={`nav-${entry.id}`}
                  tone={entry.tone}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* footer：展开态一行、折叠轨一列。5 个控件在 64px 宽度里排成一行放不下，
          而竖排一列要吃掉 ~170px，把 nav 挤到溢出并让「首页」被滚出视口（B7.2.2）。 */}
      <div
        className={cn(
          "flex items-center border-t border-border pt-2",
          collapsed ? "flex-col gap-0.5" : "flex-row justify-center gap-1",
        )}
      >
        <Button
          aria-disabled
          aria-label={t("navSettings")}
          className="disabled:opacity-40"
          data-testid="nav-settings"
          disabled
          size={collapsed ? "icon-sm" : "icon"}
          // 可访问名取 aria-label（设置），title 只解释为何不可用——若只留 title，
          // 读屏念出来的是「敬请期待」，用户不知道这个按钮是什么
          title={t("comingSoon")}
          variant="ghost"
        >
          <SettingsIcon />
        </Button>
        <NotificationBell feed={notifications} onOpen={() => onActivate(MESSAGES_ENTRY)} />
        <ThemeToggle className={collapsed ? "size-7" : "size-8"} />
        <LocaleToggle className={collapsed ? "size-7" : "size-8"} />
        <UserMenu className={collapsed ? "size-8" : undefined} />
      </div>
    </div>
  );
}

export function HomeSidebar({
  notifications,
  onOpenDesign,
  onViewChange,
  view,
}: {
  notifications: NotificationsFeed;
  onOpenDesign: () => void;
  onViewChange: (view: HomeView) => void;
  view: HomeView;
}) {
  const t = useTranslations("home");
  const { collapsed, drawerOpen, isNarrow, setDrawerOpen, toggle } = useSidebarCollapse();

  function activate(entry: NavEntry) {
    if (entry.disabled) return;
    if (entry.opensDesign) onOpenDesign();
    else if (entry.view) onViewChange(entry.view);
    // 抽屉态下导航即离开，顺手收起，避免遮罩挡住刚切换的主区
    if (isNarrow) setDrawerOpen(false);
  }

  if (isNarrow) {
    return (
      <>
        <div className="fixed left-4 top-4 z-30">
          <Button
            aria-label={t("openSidebar")}
            className="rounded-full bg-popover/90 shadow-[var(--shadow-pop)] backdrop-blur"
            data-testid="sidebar-open-button"
            onClick={toggle}
            size="icon"
            variant="outline"
          >
            <MenuIcon />
          </Button>
        </div>
        <Sheet onOpenChange={setDrawerOpen} open={drawerOpen}>
          {/* 无描述性副标题，显式置 undefined 让 Radix 跳过缺失告警 */}
          <SheetContent aria-describedby={undefined} className="w-sidebar">
            <SheetTitle className="sr-only">{t("mainNav")}</SheetTitle>
            <SheetCloseButton label={t("closeSidebar")} />
            <SidebarBody
              collapsed={false}
              notifications={notifications}
              onActivate={activate}
              view={view}
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <aside
      className={cn(
        // md: 前置守卫：窄屏首帧 isNarrow 尚未由 effect 翻正，先由 CSS 移出流外，避免闪现
        "hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none md:flex",
        collapsed ? "w-sidebar-rail" : "w-sidebar",
      )}
      data-collapsed={collapsed}
      data-testid="home-sidebar"
    >
      <SidebarBody
        collapsed={collapsed}
        notifications={notifications}
        onActivate={activate}
        onToggleCollapse={toggle}
        view={view}
      />
    </aside>
  );
}