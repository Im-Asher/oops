"use client";

/**
 * /home 应用侧栏（spec home-landing「侧栏两级导航」「折叠态与窄屏抽屉的无障碍约束」，
 * docs/DESIGN.md B7.2）。
 *
 * 两层结构：一级项 首页 / 创作 / 图库；二级项 创作›AI 画布·排版设计、图库›作品集·素材库。
 * 一级项是纯 disclosure（aria-expanded，单开），二级项才是导航目的地 —— 创作组的两个
 * 二级项都是整页路由，一级项若也承担导航，点击即离开 /home，那一组就永远看不到展开态，
 * 两级结构等于白做（design.md D1）。
 *
 * 形态取自 Canva 首页侧栏：导航项一律「图标在上、文字在下」竖排堆叠，一级与二级复用
 * 同一个 tile，层级只由 chevron、缩进与组色相区分 —— 展开/折叠两态共用一套 DOM，折叠
 * 因此只是一次单元素 width 过渡，导航项不会在动画中重排（B7.2.4）。
 *
 * 折叠态保留文字标签（B7.2.4）：64px 轨减去内边距仍容得下四个中文字，可见文本因此能
 * 与 aria-label 一致，不留「只能靠 tooltip 理解」的无障碍缺口；二级项的从属关系在轨内
 * 改由前导刻线表达（52px 可用宽度放不下缩进）。
 *
 * 纯展示组件：view 状态由 page.tsx 持有并下发；展开态由本组件内部持有（切展开态不该
 * 重渲染主区），不碰路由、不取数。
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
  ChevronDownIcon,
  ChevronRightIcon,
  ImageIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ComponentType } from "react";

/** 消息中心也在主区视图之列，但它不进导航树 —— 唯一入口是底栏铃铛。 */
export type HomeView = "home" | "portfolio" | "messages";

/** 导航树可达的主区视图。 */
type NavView = Extract<HomeView, "home" | "portfolio">;

/** 字面量联合而非 string：typed messages 下 t() 只接受已知键。 */
type NavLabelKey =
  | "navHome"
  | "groupCreate"
  | "navCanvas"
  | "navLayoutDesign"
  | "groupLibrary"
  | "navPortfolio"
  | "navAssets"
  | "navSettings";

/** 色相（B7.2.3）：创作组走品牌紫，图库组走中性，视觉权重低于创作组。 */
type Tone = "brand" | "neutral";

type GroupId = "create" | "library";

/** 导航项的四种目的地，对应四类可观察行为（spec「二级项的导航目的地」）。 */
type Destination =
  /** 切主区视图，不跳独立路由 */
  | { kind: "view"; view: NavView }
  /** 独立整页路由，渲染为 Link（目标页无应用侧栏） */
  | { kind: "href"; href: string }
  /** 先开尺寸前置设置弹窗，用户选定尺寸后进入设计工作台 */
  | { kind: "design-dialog" }
  /** 尚未实现：置灰占位 */
  | { kind: "placeholder" };

interface NavEntry {
  /** 全局唯一：当前项标记按 id 匹配，故一级项与二级项不得重名 */
  id: string;
  icon: ComponentType<{ className?: string }>;
  labelKey: NavLabelKey;
  tone: Tone;
  destination: Destination;
}

interface NavGroup {
  id: GroupId;
  icon: ComponentType<{ className?: string }>;
  labelKey: NavLabelKey;
  tone: Tone;
  entries: NavEntry[];
}

/** 首页是无子项的一级叶子；一级项带 chevron，二级项带缩进/前导刻线。 */
type NavLevel = "leaf" | "group" | "child";

const HOME_ENTRY: NavEntry = {
  destination: { kind: "view", view: "home" },
  icon: LayoutDashboardIcon,
  id: "home",
  labelKey: "navHome",
  tone: "brand",
};

const NAV_GROUPS: NavGroup[] = [
  {
    entries: [
      {
        destination: { kind: "href", href: "/canvas" },
        icon: LayoutGridIcon,
        id: "canvas",
        labelKey: "navCanvas",
        tone: "brand",
      },
      {
        destination: { kind: "design-dialog" },
        icon: LayoutTemplateIcon,
        id: "layout-design",
        labelKey: "navLayoutDesign",
        tone: "brand",
      },
    ],
    id: "create",
    icon: SparklesIcon,
    labelKey: "groupCreate",
    tone: "brand",
  },
  {
    entries: [
      {
        destination: { kind: "view", view: "portfolio" },
        icon: ImageIcon,
        id: "portfolio",
        labelKey: "navPortfolio",
        tone: "neutral",
      },
      {
        destination: { kind: "placeholder" },
        icon: ImagesIcon,
        id: "assets",
        labelKey: "navAssets",
        tone: "neutral",
      },
    ],
    id: "library",
    icon: LibraryIcon,
    labelKey: "groupLibrary",
    tone: "neutral",
  },
];

/**
 * 当前项标记的解析（spec「当前所在位置的指示」）：
 * 二级项可见时标记二级项；所属组收起时由其一级项代行 —— 用户手动收起当前组后，
 * 当前位置不会消失（design.md D4）。消息中心不在导航树内，返回 null，
 * 由底栏铃铛承担标记。
 */
function resolveCurrentMark(view: HomeView, openGroup: GroupId | null): { id: string } | null {
  if (view === "home") return { id: HOME_ENTRY.id };
  for (const group of NAV_GROUPS) {
    const hit = group.entries.find(
      (entry) => entry.destination.kind === "view" && entry.destination.view === view,
    );
    if (!hit) continue;
    return { id: openGroup === group.id ? hit.id : group.id };
  }
  return null;
}

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
 * 单个导航项：32px 方块图标 + 下方标签。折叠态与展开态共用，一级与二级也共用，仅缩进、
 * chevron 与色相不同 —— 这样切换时不需要两套 DOM（也就没有重排与两套 aria 名称要维护）。
 */
function NavTile({
  collapsed,
  current,
  disabled = false,
  expanded,
  href,
  icon: Icon,
  label,
  level,
  onActivate,
  testId,
  tone,
}: {
  collapsed: boolean;
  /** 当前所在位置：激活填充 + aria-current。所属组收起时由一级项代行（D4）。 */
  current: boolean;
  /** 置灰占位（素材库）：不可激活，title 解释其不可用 */
  disabled?: boolean;
  /** 仅一级项：组是否已展开（决定 chevron 朝向）。 */
  expanded?: boolean;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  level: NavLevel;
  onActivate: () => void;
  testId: string;
  tone: Tone;
}) {
  const t = useTranslations("home");
  const isChild = level === "child";
  /** 轨内（52px）放不下 chevron 与标签同行，从属关系改由前导刻线单独表达。 */
  const showChevron = level === "group" && !collapsed;
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  const shell = cn(
    "relative flex w-full flex-col items-center gap-1 rounded-lg outline-none transition-colors duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-ring/50",
    // 垂直预算（B7.2.2）：窄轨与面板的项高不同，否则导航项 + footer 在矮视口必然溢出
    collapsed ? "py-0.5" : "py-1",
    // 二级项在展开态左缩进 12px 表达从属；折叠态改用刻线，故此处不加缩进
    isChild && !collapsed ? "pl-4 pr-1" : "px-1",
    disabled ? "cursor-not-allowed opacity-40" : current ? "" : "hover:bg-accent/50",
  );
  const content = (
    <>
      <span
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--duration-fast)]",
          current
            ? "bg-primary text-primary-foreground"
            : tone === "brand"
              ? "bg-brand-violet-500/12 text-brand-violet-700 dark:text-brand-violet-300"
              : "bg-sidebar-accent text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
        {isChild && collapsed ? (
          <span
            aria-hidden
            className="absolute -left-2 top-1/2 h-3 w-px -translate-y-1/2 bg-brand-ink-300 dark:bg-brand-ink-700"
          />
        ) : null}
      </span>
      <span
        className={cn(
          // 窄轨内 4 个中文字约 40px，44px 可用宽度足够，故一律不截断（B7.2.2）
          "whitespace-nowrap",
          collapsed ? "text-[10px] leading-none" : "text-[11px] leading-tight",
          current ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {/* 绝对定位在项的右缘：与标签同行会把标签挤离中线，与兄弟项对不齐 */}
      {showChevron ? (
        <Chevron
          aria-hidden
          className="absolute right-1 top-5 size-3 -translate-y-1/2 text-muted-foreground"
        />
      ) : null}
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
      <Link
        aria-current={current ? "page" : undefined}
        className={shell}
        data-testid={testId}
        href={href}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      aria-current={current ? "page" : undefined}
      aria-expanded={level === "group" ? Boolean(expanded) : undefined}
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
  onOpenMessages,
  onToggleCollapse,
  onToggleGroup,
  openGroup,
  view,
}: {
  collapsed: boolean;
  notifications: NotificationsFeed;
  onActivate: (entry: NavEntry) => void;
  onOpenMessages: () => void;
  /** 抽屉态不传：该形态由 Sheet 的关闭钮承担显隐 */
  onToggleCollapse?: () => void;
  onToggleGroup: (id: GroupId) => void;
  openGroup: GroupId | null;
  view: HomeView;
}) {
  const t = useTranslations("home");
  const mark = resolveCurrentMark(view, openGroup);

  function renderEntry(entry: NavEntry, level: NavLevel) {
    const destination = entry.destination;
    return (
      <NavTile
        collapsed={collapsed}
        current={mark?.id === entry.id}
        disabled={destination.kind === "placeholder"}
        href={destination.kind === "href" ? destination.href : undefined}
        icon={entry.icon}
        key={entry.id}
        label={t(entry.labelKey)}
        level={level}
        onActivate={() => onActivate(entry)}
        testId={`nav-${entry.id}`}
        tone={entry.tone}
      />
    );
  }

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
        className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {renderEntry(HOME_ENTRY, "leaf")}
        {NAV_GROUPS.map((group, index) => (
          <div key={group.id}>
            {/* 组间发丝线（B7.2.2）：一级项标签与导航项标签几乎同形，少了分隔两组会读成一片 */}
            {index > 0 ? (
              <div
                aria-hidden
                className="mx-auto my-2 h-px w-8 bg-brand-ink-200 dark:bg-brand-ink-800"
              />
            ) : null}
            <NavTile
              collapsed={collapsed}
              current={mark?.id === group.id}
              expanded={openGroup === group.id}
              icon={group.icon}
              label={t(group.labelKey)}
              level="group"
              onActivate={() => onToggleGroup(group.id)}
              testId={`nav-${group.id}`}
              tone={group.tone}
            />
            {/* 二级项只在展开时挂载：收起态下它们不存在，当前位置由一级项代行标记 */}
            {openGroup === group.id ? (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.entries.map((entry) => renderEntry(entry, "child"))}
              </div>
            ) : null}
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
        {/* 消息中心的唯一入口：铃铛兼作该视图的当前位置指示（D5） */}
        <NotificationBell
          active={view === "messages"}
          feed={notifications}
          onOpen={onOpenMessages}
        />
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
  /**
   * 展开态刻意留在侧栏内部：放进 page.tsx 会让「切展开态」重渲染主区（composer /
   * 作品集 / 消息中心），破坏「折叠只重渲染侧栏子树」的性质（design.md D2）。
   * 不落盘：它有可推导的默认值（创作），而 collapsed 没有默认值才需要持久化（D3）。
   */
  const [openGroup, setOpenGroup] = useState<GroupId | null>("create");

  function activate(entry: NavEntry) {
    const destination = entry.destination;
    if (destination.kind === "design-dialog") onOpenDesign();
    else if (destination.kind === "view") onViewChange(destination.view);
    // 抽屉态下导航即离开，顺手收起，避免遮罩挡住刚切换的主区
    if (isNarrow) setDrawerOpen(false);
  }

  /** 单开：展开另一组即收起本组。抽屉态不随之收起 —— 切展开态不是导航。 */
  function toggleGroup(id: GroupId) {
    setOpenGroup((prev) => (prev === id ? null : id));
  }

  function openMessages() {
    onViewChange("messages");
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
              onOpenMessages={openMessages}
              onToggleGroup={toggleGroup}
              openGroup={openGroup}
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
        onOpenMessages={openMessages}
        onToggleCollapse={toggle}
        onToggleGroup={toggleGroup}
        openGroup={openGroup}
        view={view}
      />
    </aside>
  );
}
