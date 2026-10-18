"use client";

/**
 * 铃铛未读角标（/home 侧栏底栏）：只负责展示与跳转消息中心视图。
 * 计数来自 /home 持有的 feed（与消息中心列表同一份状态），不在组件内另挂轮询。
 */
import { BellIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NotificationsFeed } from "@/lib/notifications/use-notifications";

export function NotificationBell({
  feed,
  onOpen,
}: {
  feed: NotificationsFeed;
  /** 切到消息中心视图；组件自己不碰路由状态 */
  onOpen: () => void;
}) {
  const t = useTranslations("notifications");
  const count = feed.unreadCount;

  return (
    <button
      aria-label={count > 0 ? t("bellLabel", { count }) : t("filter.label")}
      className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
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
