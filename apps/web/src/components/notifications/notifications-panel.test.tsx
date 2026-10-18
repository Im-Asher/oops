// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import type {
  NotificationItem,
  NotificationsFeed,
} from "@/lib/notifications/use-notifications";
import { NotificationsPanel } from "./notifications-panel";

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    source: "system",
    category: "credits.exhausted",
    level: "critical",
    title: "积分已耗尽",
    body: "当前余额 0，已无法继续生成，请联系管理员补充积分。",
    i18nKey: "notifications.credits.exhausted",
    i18nParams: { balance: 0 },
    createdAt: "2026-10-18T08:00:00.000Z",
    readAt: null,
    ...over,
  };
}

/** 面板是纯视图：注入 feed stub，断言只落在渲染与回调上。 */
function makeFeed(over: Partial<NotificationsFeed> = {}): NotificationsFeed {
  return {
    items: [],
    total: 0,
    unreadCount: 0,
    state: "ready",
    error: null,
    source: "all",
    setSource: vi.fn(),
    retry: vi.fn(),
    markRead: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationsPanel", () => {
  it("系统消息按词典渲染标题与正文（带 balance 插值）", () => {
    renderWithI18n(<NotificationsPanel feed={makeFeed({ items: [item()], total: 1 })} />);

    // 词典值而非库里中文原文：标题走 credits.exhaustedTitle，正文走 credits.exhausted
    expect(screen.getByText("积分已耗尽")).toBeTruthy();
    expect(screen.getByText("当前余额 0，已无法继续生成，请联系管理员补充积分。")).toBeTruthy();
  });

  it("词典未登记的类别回退消息主体的中文原文", () => {
    renderWithI18n(
      <NotificationsPanel
        feed={makeFeed({
          items: [
            item({
              category: "credits.mystery",
              i18nKey: "notifications.credits.mystery",
              i18nParams: null,
              title: "库里的标题",
              body: "库里的正文",
            }),
          ],
          total: 1,
        })}
      />,
    );

    expect(screen.getByText("库里的标题")).toBeTruthy();
    expect(screen.getByText("库里的正文")).toBeTruthy();
  });

  it("管理员消息（无 i18nKey）原样展示", () => {
    renderWithI18n(
      <NotificationsPanel
        feed={makeFeed({
          items: [
            item({
              source: "admin",
              category: "admin.broadcast",
              i18nKey: null,
              i18nParams: null,
              title: "停机维护通知",
              body: "今晚 02:00 停机 10 分钟",
            }),
          ],
          total: 1,
        })}
      />,
    );

    expect(screen.getByText("停机维护通知")).toBeTruthy();
    expect(screen.getByText("今晚 02:00 停机 10 分钟")).toBeTruthy();
  });

  it("未读与已读可区分；点击未读条目回调 markRead，已读条目不可点", () => {
    const feed = makeFeed({
      items: [item({ id: "u1" }), item({ id: "r1", readAt: "2026-10-18T09:00:00.000Z" })],
      total: 2,
      unreadCount: 1,
    });
    renderWithI18n(<NotificationsPanel feed={feed} />);

    const unread = screen.getByTestId("notification-u1");
    const read = screen.getByTestId("notification-r1");
    expect(unread.getAttribute("data-read")).toBe("unread");
    expect(read.getAttribute("data-read")).toBe("read");
    expect(screen.getAllByTestId("notification-unread-dot")).toHaveLength(1);
    expect((read as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(unread);
    expect(feed.markRead).toHaveBeenCalledWith("u1");
  });

  it("未读数为 0 时禁用全部已读；有点击时回调 markAllRead", () => {
    const feed = makeFeed({ items: [item()], total: 1, unreadCount: 1 });
    const { unmount } = renderWithI18n(<NotificationsPanel feed={feed} />);
    const button = screen.getByTestId("notifications-mark-all") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(feed.markAllRead).toHaveBeenCalledTimes(1);
    unmount();

    renderWithI18n(<NotificationsPanel feed={makeFeed()} />);
    expect(
      (screen.getByTestId("notifications-mark-all") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("切来源筛选回调 setSource", () => {
    const feed = makeFeed({ items: [item()], total: 1 });
    renderWithI18n(<NotificationsPanel feed={feed} />);

    // 当前筛选为 all，故三项都不高亮；点击把目标来源交回给父级
    expect(screen.getByTestId("notifications-filter-all").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("notifications-filter-admin"));
    expect(feed.setSource).toHaveBeenCalledWith("admin");
  });

  it("空态按筛选给不同文案；错误态给告警与重试", () => {
    const { unmount } = renderWithI18n(<NotificationsPanel feed={makeFeed()} />);
    expect(screen.getByText("还没有任何消息")).toBeTruthy();
    unmount();

    renderWithI18n(
      <NotificationsPanel feed={makeFeed({ source: "admin" })} />,
    );
    expect(screen.getByText("该来源下暂无消息")).toBeTruthy();
  });

  it("error 态展示错误文案与重试入口", () => {
    const feed = makeFeed({ state: "error", error: "消息加载失败，请重试" });
    renderWithI18n(<NotificationsPanel feed={feed} />);

    expect(screen.getByRole("alert").textContent).toBe("消息加载失败，请重试");
    fireEvent.click(screen.getByText("重试"));
    expect(feed.retry).toHaveBeenCalledTimes(1);
  });

  it("loading 态不渲染列表", () => {
    const { container } = renderWithI18n(
      <NotificationsPanel feed={makeFeed({ state: "loading" })} />,
    );
    expect(screen.queryByTestId("notifications-list")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });
});
