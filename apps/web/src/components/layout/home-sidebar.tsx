"use client";

/**
 * /home 应用侧栏（spec home-landing「一级列与二级面板结构」「一级项展开面板并落到默认子项」
 * 「二级面板的开合约束」「当前位置的委托标记」，docs/DESIGN.md B7.2）。
 *
 * 形态是**常驻 64px 一级列 + 并排的二级面板**：一级项常驻最左列，二级项只在该组的
 * 面板里出现。面板是 rail 的**兄弟节点**而非浮层 —— 它占布局宽度、挤压主区（design D1），
 * 对齐参照实现 Canva 项目页的实测：面板展开时主区 1121px → 857px。
 *
 * 一级行只有**一个**可激活目标：激活它 = 展开该组面板，并落到该组的默认子项
 * （design D4）。行内不再有展开控件。
 * 面板的开合有两个入口：这个行本身，以及 rail 顶部的线性开关（Canva 实测采用后者）。
 * 激活一级项**不跳转**—— 默认子项若是整页路由（创作 → /canvas）就只展开面板等用户选，
 * 否则用户还没得及选第二级就被带离 /home（design D4）。
 *
 * 纯展示组件：view 状态由 page.tsx 持有并下发；面板开合由本组件内部持有（切面板不该
 * 重渲染主区），不碰路由、不取数。
 */
import { UserMenu } from "@/components/chat/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetCloseButton, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSidebarDisclosureHotkey, useSidebarLayout } from "@/lib/layout/use-sidebar-layout";
import { APP_VERSION } from "@/lib/version";
import type { NotificationsFeed } from "@/lib/notifications/use-notifications";
import {
  ImageIcon,
  ImagesIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LayoutTemplateIcon,
  LibraryIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
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

type GroupId = "create" | "library";

/** 用户在一级列上的显式选择：点 L1 = 选中它的默认子项。null = 跟随主区视图推导。 */
type SelectedChild = { group: GroupId; childId: string };

/** `Cmd/Ctrl+B` 在当前视图不属于任何组时打开谁的二级面板。 */
const FIRST_GROUP_ID: GroupId = "create";

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

/** 导航项的目的地，对应几类可观察行为（spec「一级项展开面板并落到默认子项」）。 */
type Destination =
  /** 切主区视图，不跳独立路由 */
  | { kind: "view"; view: NavView }
  /** 独立整页路由，渲染为 Link（目标页无应用侧栏） */
  | { kind: "href"; href: string }
  /** 先开尺寸前置设置弹窗，用户选定尺寸后进入设计工作台 */
  | { kind: "design-dialog" }
  /** 尚未实现：置灰占位 */
  | { kind: "placeholder" };

interface NavItem {
  /** 全局唯一：当前项标记按 id 匹配，故一级项与二级项不得重名 */
  id: string;
  icon: ComponentType<{ className?: string }>;
  labelKey: NavLabelKey;
  destination: Destination;
}

interface NavGroup {
  id: GroupId;
  icon: ComponentType<{ className?: string }>;
  labelKey: NavLabelKey;
  /** 激活该一级项时落到的子项：显式声明而非靠数组顺序推断（design D4） */
  primaryId: string;
  entries: NavItem[];
}

/** 首页是无子项的一级叶子。 */
const HOME_ITEM: NavItem = {
  destination: { kind: "view", view: "home" },
  icon: LayoutDashboardIcon,
  id: "home",
  labelKey: "navHome",
};

const NAV_GROUPS: NavGroup[] = [
  {
    entries: [
      {
        destination: { kind: "href", href: "/canvas" },
        icon: LayoutGridIcon,
        id: "canvas",
        labelKey: "navCanvas",
      },
      {
        destination: { kind: "design-dialog" },
        icon: LayoutTemplateIcon,
        id: "layout-design",
        labelKey: "navLayoutDesign",
      },
    ],
    icon: SparklesIcon,
    id: "create",
    labelKey: "groupCreate",
    primaryId: "canvas",
  },
  {
    entries: [
      {
        destination: { kind: "view", view: "portfolio" },
        icon: ImageIcon,
        id: "portfolio",
        labelKey: "navPortfolio",
      },
      {
        destination: { kind: "placeholder" },
        icon: ImagesIcon,
        id: "assets",
        labelKey: "navAssets",
      },
    ],
    icon: LibraryIcon,
    id: "library",
    labelKey: "groupLibrary",
    primaryId: "portfolio",
  },
];

/** primaryId 是数据不变量：新增子项时不必改这里，忘写会在运行时立刻炸出来。 */
function primaryOf(group: NavGroup): NavItem {
  const hit = group.entries.find((entry) => entry.id === group.primaryId);
  if (!hit) throw new Error(`NAV_GROUPS.${group.id}.primaryId does not match any entry`);
  return hit;
}

/** 当前视图所属的组；首页与消息中心不属于任何组，返回 null。 */
function groupOfView(view: HomeView): GroupId | null {
  if (view === "messages") return null;
  return (
    NAV_GROUPS.find((group) =>
      group.entries.some(
        (entry) => entry.destination.kind === "view" && entry.destination.view === view,
      ),
    )?.id ?? null
  );
}

/**
 * 当前项标记的解析（spec「当前位置的委托标记」）：
 * 面板展开时标记面板内的二级项；面板未展开时由其一级项代行 —— 用户收起面板后，
 * 当前位置不会消失（design D7）。消息中心不在导航树内，返回 null，
 * 由底栏铃铛承担标记。
 */
/**
 * 当前位置的两个分量（spec「当前位置的委托标记」）：
 *
 * - `sectionId` —— 目前所在的**一级分区**，决定哪个 rail tile 填色直。用户点了哪个 L1
 *   就是哪个，与主区还停在哪里无关（参照实现里点「项目」后两者同时变亮）。
 * - `markId` —— `aria-current="page"` 的唯一落点，总是**最深的那一项**：面板展开时是面板内的二级项，
 *   面板收起时由它的一级项代行（否则一收面板就不知道用户在哪里）。
 *
 * 两者分离是必要的：点「创作」只选中它的默认子项「AI 画布」（整页路由，主区不变），
 * 既要让「创作」的 tile 亮起来，又不能把主区里的落地页说成是「AI 画布」。
 */
function resolveSectionId(view: HomeView, selected: SelectedChild | null): string | null {
  if (selected) return selected.group;
  if (view === "home") return HOME_ITEM.id;
  return view === "portfolio" ? "library" : null;
}

function resolveMarkId(
  view: HomeView,
  openPanel: GroupId | null,
  selected: SelectedChild | null,
): string | null {
  if (selected) {
    // 面板收起时二级项已离开可访问性树，标记由其一级项代行
    return openPanel === selected.group ? selected.childId : selected.group;
  }
  if (view === "home") return HOME_ITEM.id;
  for (const group of NAV_GROUPS) {
    const hit = group.entries.find(
      (entry) => entry.destination.kind === "view" && entry.destination.view === view,
    );
    if (!hit) continue;
    return openPanel === group.id ? hit.id : group.id;
  }
  return null;
}

/**
 * 一级列里的导航目标：图标在上、文字在下，占满 64px 一级列的内容框。
 * 可见文字即 `aria-label`（两个汉字 11px ≈ 22px，落在 56px 内容框内），
 * 故 rail 内不出现 tooltip-only 的无障碍缺口。
 *
 * 整行只有这一个目标：激活它 = 展开本组面板 + 落到本组第一个子项。
 */
function RailTarget({
  current,
  href,
  icon: Icon,
  label,
  onActivate,
  section,
  testId,
}: {
  /** 是否携带 aria-current（最深的那一项） */
  current: boolean;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onActivate: () => void;
  /** 是否为目前所在的一级分区（填色 tile） */
  section: boolean;
  testId: string;
}) {
  const body = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          section
            ? "bg-primary text-primary-foreground"
            : "bg-sidebar-accent text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-[11px] leading-tight",
          section ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </>
  );
  const shell = cn(
    "flex w-full shrink-0 flex-col items-center gap-1 rounded-lg py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
    section ? "" : "hover:bg-accent/50",
  );
  if (href) {
    return (
      <Link
        aria-current={current ? "page" : undefined}
        className={shell}
        data-testid={testId}
        href={href}
        onClick={onActivate}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      aria-current={current ? "page" : undefined}
      className={shell}
      data-testid={testId}
      onClick={onActivate}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * 横向导航目标：二级面板内的二级项、窄屏抽屉里的一级项与二级项共用。
 * 264px 宽的面板里 icon + 四字文案绰绰有余，故只在极端窄屏下截断。
 * 40px 行高 + 整行圆角药丸选中态，对齐参照实现的二级面板观感。
 */
function RowTarget({
  className,
  current,
  disabled = false,
  href,
  icon: Icon,
  label,
  onActivate,
  testId,
}: {
  className?: string;
  current: boolean;
  disabled?: boolean;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onActivate: () => void;
  testId: string;
}) {
  const t = useTranslations("home");
  const body = (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center">
        <Icon className={cn("size-3.5", current ? "text-primary" : "text-muted-foreground")} />
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[13px]",
          current ? "font-medium text-primary" : "text-foreground/80",
        )}
      >
        {label}
      </span>
    </>
  );
  const shell = cn(
    "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
    disabled ? "cursor-not-allowed opacity-40" : current ? "bg-primary/10" : "hover:bg-accent/60",
    className,
  );

  if (disabled) {
    // 可访问名取可见文字（素材库），title 只解释为何不可用
    return (
      <button
        aria-disabled
        className={shell}
        data-testid={testId}
        disabled
        title={t("comingSoon")}
        type="button"
      >
        {body}
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
        onClick={onActivate}
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      aria-current={current ? "page" : undefined}
      className={shell}
      data-testid={testId}
      onClick={onActivate}
      type="button"
    >
      {body}
    </button>
  );
}

/** 导航项是否是独立路由（渲染为 Link）；view / design-dialog / placeholder 都不是。 */
function navItemHref(item: NavItem): string | undefined {
  return item.destination.kind === "href" ? item.destination.href : undefined;
}

/** 组间发丝线（B7.2.2）：一级项标签与导航项标签几乎同形，少了分隔两组会读成一片。 */
function GroupSeparator() {
  return (
    <div aria-hidden className="mx-auto my-2 h-px w-8 bg-brand-ink-200 dark:bg-brand-ink-800" />
  );
}

function SidebarBody({
  notifications,
  onActivate,
  onActivateGroup,
  onActivateLeaf,
  markId,
  onOpenMessages,
  onTogglePanel,
  openPanel,
  sectionId,
  variant,
  view,
}: {
  notifications: NotificationsFeed;
  onActivate: (item: NavItem) => void;
  /** 激活一级项 = 展开其面板，并落到其在当前页内的默认子项 */
  onActivateGroup: (group: NavGroup) => void;
  /** 激活无子项的一级叶子 = 收起面板 + 回落地页 */
  onActivateLeaf: () => void;
  onOpenMessages: () => void;
  /** aria-current 的唯一落点：最深的那一项（解析见 resolveMarkId） */
  markId: string | null;
  /** 顶部开关：只负责展开/收起面板，不触发任何导航 */
  onTogglePanel: () => void;
  openPanel: GroupId | null;
  /** 目前所在的一级分区：决定哪个 rail tile 填色（解析见 resolveSectionId） */
  sectionId: string | null;
  /** rail = 常驻一级列；inline = 窄屏覆盖抽屉内的平铺列表 */
  variant: "rail" | "inline";
  view: HomeView;
}) {
  const t = useTranslations("home");
  const rail = variant === "rail";

  function renderChild(item: NavItem, className?: string) {
    return (
      <RowTarget
        className={className}
        current={markId === item.id}
        disabled={item.destination.kind === "placeholder"}
        href={navItemHref(item)}
        icon={item.icon}
        key={item.id}
        label={t(item.labelKey)}
        onActivate={() => onActivate(item)}
        testId={`nav-${item.id}`}
      />
    );
  }

  /**
   * 窄屏没有可展开的面板（一级项点击不再导航），也不能叠浮层
   * （模态 Dialog 会给兄弟节点加 aria-hidden）。故一级项降为**非交互的分组标题**，
   * 其二级项平铺在下方 —— 不留一个点了只会展开一个不存在的面板的入口。
   */
  function renderInlineGroup(group: NavGroup, index: number) {
    return (
      <div key={group.id}>
        {index > 0 ? <GroupSeparator /> : null}
        <div
          className="px-3 pb-1 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground"
          data-testid={`nav-group-${group.id}`}
        >
          {t(group.labelKey)}
        </div>
        <div className="flex flex-col gap-0.5">
          {group.entries.map((entry) => renderChild(entry))}
        </div>
      </div>
    );
  }

  function renderRailGroup(group: NavGroup, index: number) {
    return (
      <div key={group.id}>
        {index > 0 ? <GroupSeparator /> : null}
        <RailTarget
          current={markId === group.id}
          icon={group.icon}
          label={t(group.labelKey)}
          section={sectionId === group.id}
          // 无论 L1 是 Link（整页路由）还是按钮（切视图），都要先把本组面板打开
          onActivate={() => onActivateGroup(group)}
          testId={`nav-${group.id}`}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-1 py-2">
      {/* rail 顶部：产品标识 + 二级面板开关。开关是面板的全局开合，与第一号 L1
          项并列 —— 参照实现用的就是这个线性开关（aria-label 「切换侧边导航栏」）。
          构建版本在用户菜单里，64px 一级列放不下它（spec「构建版本徽标的位置」） */}
      {/* rail 顶部只有面板开关：品牌标识与构建版本在二级面板头部（参照片即如此），
          64px 一级列塞不下 wordmark + 徽标。 */}
      {rail ? (
        <div className="flex items-center justify-center pb-2">
          <Button
            aria-controls="home-l2-panel"
            aria-expanded={openPanel !== null}
            aria-label={openPanel ? t("collapsePanel") : t("expandPanel")}
            className="size-7 shrink-0 text-muted-foreground"
            data-testid="sidebar-panel-toggle"
            onClick={onTogglePanel}
            size="icon"
            variant="ghost"
          >
            {openPanel ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
          </Button>
        </div>
      ) : null}

      <nav
        aria-label={t("mainNav")}
        className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {rail ? (
          <RailTarget
            current={markId === HOME_ITEM.id}
            icon={HOME_ITEM.icon}
            label={t(HOME_ITEM.labelKey)}
            section={sectionId === HOME_ITEM.id}
            onActivate={onActivateLeaf}
            testId={`nav-${HOME_ITEM.id}`}
          />
        ) : (
          <RowTarget
            current={markId === HOME_ITEM.id}
            icon={HOME_ITEM.icon}
            label={t(HOME_ITEM.labelKey)}
            onActivate={onActivateLeaf}
            testId={`nav-${HOME_ITEM.id}`}
          />
        )}
        {NAV_GROUPS.map((group, index) =>
          rail ? renderRailGroup(group, index) : renderInlineGroup(group, index),
        )}
      </nav>

      {/* footer 只留消息中心入口与账号：主题/语言/设置收进用户菜单（design D8） */}
      <div
        className="flex flex-col items-center gap-1 border-t border-border pt-2"
        data-testid="sidebar-footer"
      >
        {/* 消息中心的唯一入口：铃铛兼作该视图的当前位置指示 */}
        <NotificationBell
          active={view === "messages"}
          feed={notifications}
          onOpen={onOpenMessages}
        />
        <UserMenu className="size-8" showPreferences />
      </div>
    </div>
  );
}

/** 二级面板的内容：某个组的全部二级项（spec「二级面板的开合约束」）。 */
function SecondLevelPanel({
  group,
  markId,
  onActivate,
}: {
  group: NavGroup;
  markId: string | null;
  onActivate: (item: NavItem) => void;
}) {
  const t = useTranslations("home");
  return (
    <div className="flex w-sidebar-drawer flex-col" data-testid={`nav-panel-${group.id}`}>
      {/* 品牌与构建版本只在这里出现（spec「构建版本徽标的位置」）：一级列只剩面板开关 */}
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <span className="min-w-0 truncate text-base font-semibold tracking-wide text-foreground">
          oops
        </span>
        <span
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          data-testid="app-version-badge"
        >
          {t("buildVersion", { version: APP_VERSION })}
        </span>
      </div>
      <nav
        aria-label={t("subNav", { group: t(group.labelKey) })}
        className="flex flex-col gap-0.5 px-2 pb-2"
      >
        {group.entries.map((entry) => (
          <RowTarget
            current={markId === entry.id}
            disabled={entry.destination.kind === "placeholder"}
            href={navItemHref(entry)}
            icon={entry.icon}
            key={entry.id}
            label={t(entry.labelKey)}
            // 激活二级项后面板保持展开（design D5）：推挤式下每次选择都收起
            // 会让主区宽度反复跳变
            onActivate={() => onActivate(entry)}
            testId={`nav-${entry.id}`}
          />
        ))}
      </nav>
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
  const { drawerOpen, isNarrow, setDrawerOpen, toggleDrawer: toggleSheet } = useSidebarLayout();
  /**
   * 面板开合刻意留在侧栏内部：放进 page.tsx 会让「切面板」重渲染主区（composer /
   * 作品集 / 消息中心）。不落盘：二级面板是一次 peek，残留的 open 会让用户回来时
   * 面对一列自己没打开过的导航（design D9）。
   */
  /**
   * 用户在一级列上的显式选择。它与主区视图解耦：点「创作」会选中它的默认子项
   * 「AI 画布」，但主区仍是落地页（它是整页路由，没有当页形态）。若还原地从视图推导，
   * 创作的 tile 就不会亮起来（design D7）。
   */
  const [selected, setSelected] = useState<SelectedChild | null>(null);
  const [openPanel, setOpenPanel] = useState<GroupId | null>(null);
  /**
   * 面板里渲染哪一组：打开时同步写入，**收起后不清空** —— 主区回满宽的这 320ms 里
   * 擦除的应该是内容，而不是一条空条（design D2）。收起态由宽度 0 + inert 把整列
   * 移出布局与可访问性树，故不清空不违反 spec。
   */
  const [panelId, setPanelId] = useState<GroupId | null>(null);

  function showPanel(id: GroupId | null) {
    setOpenPanel(id);
    if (id) setPanelId(id);
  }

  const panelGroup = NAV_GROUPS.find((group) => group.id === panelId);
  // 两个标记在这里解析一次、下发给 rail 与面板（两个子树共用同一份答案）
  const sectionId = resolveSectionId(view, selected);
  const markId = resolveMarkId(view, openPanel, selected);

  function activate(item: NavItem) {
    const destination = item.destination;
    if (destination.kind === "design-dialog") onOpenDesign();
    else if (destination.kind === "view") onViewChange(destination.view);
    // 窄屏抽屉态下导航即离开，顺手收起，避免遮罩挡住刚切换的主区
    if (isNarrow) setDrawerOpen(false);
  }

  /** 激活一级项 = 展开本组面板 + 落到其默认子项（单开由 showPanel 天然保证）。 */
  function activateGroup(group: NavGroup) {
    showPanel(group.id);
    const primary = primaryOf(group);
    setSelected({ childId: primary.id, group: group.id });
    // 默认子项若是整页路由（创作 → /canvas）就不跳：否则用户还没得及在面板里
    // 选第二级（排版设计）就被带离 /home，面板根本看不到。
    if (primary.destination.kind === "view") activate(primary);
  }

  /** 面板内激活二级项：先记住选择（一级 tile 随之亮起），再执行它的目的地。 */
  function activatePanelItem(group: NavGroup, item: NavItem) {
    setSelected({ childId: item.id, group: group.id });
    activate(item);
  }

  /** 无子项的一级叶子：收起面板并回落地页。 */
  function activateLeaf() {
    showPanel(null);
    setSelected(null);
    activate(HOME_ITEM);
  }

  function openMessages() {
    setSelected(null);
    onViewChange("messages");
    if (isNarrow) setDrawerOpen(false);
  }

  // Cmd/Ctrl+B 显隐二级层：桌面开合当前视图所属组的面板，窄屏开合覆盖抽屉（design D10）
  /**
   * 面板开合：收起时恢复上一次展开的组，打开时优先当前视图所属的组。
   * 顶部开关与 Cmd/Ctrl+B 共用它，不会分叉。
   */
  function togglePanel() {
    showPanel(openPanel ? null : (panelId ?? groupOfView(view) ?? FIRST_GROUP_ID));
  }

  useSidebarDisclosureHotkey(() => {
    if (isNarrow) toggleSheet();
    else togglePanel();
  });

  if (isNarrow) {
    return (
      <>
        <div className="fixed left-4 top-4 z-30">
          <Button
            aria-label={t("openSidebar")}
            className="rounded-full bg-popover/90 shadow-[var(--shadow-pop)] backdrop-blur"
            data-testid="sidebar-open-button"
            onClick={toggleSheet}
            size="icon"
            variant="outline"
          >
            <MenuIcon />
          </Button>
        </div>
        <Sheet onOpenChange={setDrawerOpen} open={drawerOpen}>
          {/* 无描述性副标题，显式置 undefined 让 Radix 跳过缺失告警 */}
          <SheetContent aria-describedby={undefined} className="w-sidebar-drawer">
            <SheetTitle className="sr-only">{t("mainNav")}</SheetTitle>
            <SheetCloseButton label={t("closeSidebar")} />
            {/* 平铺全部层级：一级项点击即导航，没有可展开的面板；而模态 Dialog 会给
                portaled 浮层加 aria-hidden，浮层落在焦点陷阱之外（design D6） */}
            <SidebarBody
              notifications={notifications}
              onActivate={activate}
              onActivateGroup={activateGroup}
              onActivateLeaf={activateLeaf}
              onOpenMessages={openMessages}
              markId={resolveMarkId(view, null, selected)}
              onTogglePanel={togglePanel}
              openPanel={null}
              sectionId={resolveSectionId(view, selected)}
              variant="inline"
              view={view}
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      <aside
        className="hidden w-sidebar-rail shrink-0 flex-col border-r border-border bg-sidebar md:flex"
        data-testid="home-sidebar"
      >
        <SidebarBody
          notifications={notifications}
          onActivate={activate}
          onActivateGroup={activateGroup}
          onActivateLeaf={activateLeaf}
          onOpenMessages={openMessages}
          markId={markId}
          onTogglePanel={togglePanel}
          openPanel={openPanel}
          sectionId={sectionId}
          variant="rail"
          view={view}
        />
      </aside>

      {/* 二级面板：rail 的兄弟节点，占布局宽度把主区挤窄（design D1）。
          收起态宽度归零 + inert，使面板内导航项离开 Tab 序列与可访问性树。 */}
      <aside
        aria-hidden={openPanel ? undefined : true}
        className={cn(
          "hidden shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-[--duration-slow] ease-[--ease-standard] motion-reduce:transition-none md:block",
          openPanel ? "w-sidebar-drawer" : "w-0 border-r-0",
        )}
        data-testid="home-panel"
        id="home-l2-panel"
        inert={openPanel ? undefined : true}
      >
        {panelGroup ? (
          <SecondLevelPanel
            group={panelGroup}
            markId={markId}
            onActivate={(item) => activatePanelItem(panelGroup, item)}
          />
        ) : null}
      </aside>
    </>
  );
}
