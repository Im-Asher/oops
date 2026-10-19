"use client";

/**
 * 铃铛未读角标（/home 侧栏底栏）：只负责展示与跳转消息中心视图。
 * 计数来自 /home 持有的 feed（与消息中心列表同一份状态），不在组件内另挂轮询。
 *
 * 它也是消息中心的**唯一入口**（spec home-landing「消息中心的唯一入口是底栏铃铛」），
 * 因此兼作该视图的当前位置指示：active 时带 aria-current —— 导航树里没有消息中心项，
 * 当前位置只能由它承担。
 */
import { BellIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NotificationsFeed } from "@/lib/notifications/use-notifications";
import { cn } from "cn";

export function NotificationBell({
  active,
  feed,
  onOpen,
}: {
  /** 主区正在显示消息中心：呈激活态并承担当前位置标记 */
  active: boolean;
  feed: NotificationsFeed;
  /** 切到消息中心视图；组件自己不碰路由状态 */
  onOpen: () => void;
}) {
  const t = useTranslations("notifications");
  const count = feed.unreadCount;

  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={count > 0 ? t("bellLabel", { count }) : t("filter.label")}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent/60 hover:text-foreground",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
      )}
      data-active={active ? "true" : undefined}
      data-testid="notifications-bell"
      onClick={onOpen}
      title={t("unreadCount", { count })}
      type="button"
    >
      <BellIcon className="size-4" />
      {count > 0 ? (
        <span
          className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground"
          data-testid="notifications-bell-count"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
