"use client";

/**
 * 消息中心视图（/home 主区之一，D10）：列表 + 来源筛选 + 单条/全部已读。
 * 系统消息按行内 i18nKey 的语义查词典渲染，词典未登记的类别回退消息主体
 * 保存的中文原文（D8）；管理员消息无 i18nKey，一律原样展示。
 */
import { Loader2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type {
  NotificationItem,
  NotificationSourceFilter,
  NotificationsFeed,
} from "@/lib/notifications/use-notifications";

/** 筛选项与词典键成对声明，避免模板字符串拼键丢掉类型检查。 */
const FILTERS: ReadonlyArray<{
  key: NotificationSourceFilter;
  label: "filter.all" | "filter.system" | "filter.admin";
}> = [
  { key: "all", label: "filter.all" },
  { key: "system", label: "filter.system" },
  { key: "admin", label: "filter.admin" },
];

interface Copy {
  title: string;
  body: string;
}

/** 只保留可插值的原始值，避免把任意结构塞进 next-intl 的 params。 */
function interpolationParams(
  params: Record<string, unknown> | null,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out;
}

/**
 * 纯展示组件：取数由 /home 持有并注入，铃铛与本视图共用同一份状态，
 * 免掉两处各挂一个 hook 造成的双份轮询（4.2 的共享状态约定）。
 */
export function NotificationsPanel({ feed }: { feed: NotificationsFeed }) {
  const t = useTranslations("notifications");
  const th = useTranslations("home");
  const locale = useLocale();

  /**
   * 本地化文案。这里按 category 显式配对键位，而不是拿 i18nKey 去撞词典：
   * next-intl v4 没有 `t.has`，未知键只会打一条 onError 再返回键名，既脏又不可靠。
   * 配对表让「新增系统消息」成为一次显式改动（键名受编译期校验），
   * 未登记的类别自然落到中文兜底（D8）。
   */
  function copyOf(item: NotificationItem): Copy {
    if (item.i18nKey) {
      const params = interpolationParams(item.i18nParams);
      if (item.category === "credits.low") {
        return { title: t("credits.lowTitle"), body: t("credits.low", params) };
      }
      if (item.category === "credits.exhausted") {
        return { title: t("credits.exhaustedTitle"), body: t("credits.exhausted", params) };
      }
    }
    return { title: item.title, body: item.body };
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold text-foreground">{th("navMessages")}</h1>
          {feed.unreadCount > 0 ? (
            <span
              className="text-sm text-muted-foreground"
              data-testid="notifications-unread"
            >
              {t("unreadCount", { count: feed.unreadCount })}
            </span>
          ) : null}
        </div>
        <Button
          data-testid="notifications-mark-all"
          disabled={feed.unreadCount === 0}
          onClick={() => void feed.markAllRead()}
          size="sm"
          variant="outline"
        >
          {t("markAllRead")}
        </Button>
      </header>

      <div
        aria-label={t("filter.label")}
        className="flex flex-wrap gap-2"
        data-testid="notifications-filters"
        role="group"
      >
        {FILTERS.map((f) => (
          <button
            aria-pressed={feed.source === f.key}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              feed.source === f.key
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
            data-testid={`notifications-filter-${f.key}`}
            key={f.key}
            onClick={() => feed.setSource(f.key)}
            type="button"
          >
            {t(f.label)}
          </button>
        ))}
      </div>

      {feed.state === "loading" ? (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : feed.state === "error" ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-sm text-muted-foreground" role="alert">
            {feed.error}
          </p>
          <Button onClick={feed.retry} variant="outline">
            {t("retry")}
          </Button>
        </div>
      ) : feed.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <p className="text-base font-medium">
            {feed.source === "all" ? t("empty") : t("emptyFiltered")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="notifications-list">
          {feed.items.map((item) => {
            const copy = copyOf(item);
            const unread = item.readAt === null;
            return (
              <li key={item.id}>
                <button
                  className={`flex w-full flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                    unread
                      ? "border-border bg-card hover:bg-accent/40"
                      : "border-transparent bg-muted/40 hover:bg-muted/60"
                  }`}
                  data-read={unread ? "unread" : "read"}
                  data-testid={`notification-${item.id}`}
                  disabled={!unread}
                  onClick={() => void feed.markRead(item.id)}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    {unread ? (
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                        data-testid="notification-unread-dot"
                      />
                    ) : null}
                    <span
                      className={
                        unread
                          ? "text-sm font-medium text-foreground"
                          : "text-sm text-muted-foreground"
                      }
                    >
                      {copy.title}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">{copy.body}</span>
                  <time
                    className="text-xs text-muted-foreground/70"
                    dateTime={item.createdAt}
                    suppressHydrationWarning
                  >
                    {formatTime(item.createdAt)}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
