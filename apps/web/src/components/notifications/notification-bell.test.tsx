// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import type { NotificationsFeed } from "@/lib/notifications/use-notifications";
import { NotificationBell } from "./notification-bell";

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

describe("NotificationBell", () => {
  it("无未读时不显示角标", () => {
    renderWithI18n(<NotificationBell active={false} feed={makeFeed()} onOpen={vi.fn()} />);
    expect(screen.queryByTestId("notifications-bell-count")).toBeNull();
  });

  it("有未读时展示计数并把数量写进无障碍标签", () => {
    renderWithI18n(
      <NotificationBell active={false} feed={makeFeed({ unreadCount: 3 })} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId("notifications-bell-count").textContent).toBe("3");
    expect(screen.getByTestId("notifications-bell").getAttribute("aria-label")).toContain("3");
  });

  it("超过 99 收敛为 99+", () => {
    renderWithI18n(
      <NotificationBell active={false} feed={makeFeed({ unreadCount: 120 })} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId("notifications-bell-count").textContent).toBe("99+");
  });

  it("点击回调 onOpen", () => {
    const onOpen = vi.fn();
    renderWithI18n(
      <NotificationBell active={false} feed={makeFeed({ unreadCount: 1 })} onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByTestId("notifications-bell"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  /**
   * 消息中心在导航树里没有条目，当前位置只能由铃铛承担（spec home-landing
   * 「消息中心的唯一入口是底栏铃铛」）：active 时必须带 aria-current，
   * 且未读角标照常共存 —— 角标说的是「有多少未读」，aria-current 说的是「我在哪」。
   */
  it("active 时承担当前位置标记，且不影响未读角标", () => {
    const { rerender } = renderWithI18n(
      <NotificationBell active={false} feed={makeFeed({ unreadCount: 2 })} onOpen={vi.fn()} />,
    );
    const bell = () => screen.getByTestId("notifications-bell");
    expect(bell().getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("notifications-bell-count").textContent).toBe("2");

    rerender(<NotificationBell active feed={makeFeed({ unreadCount: 2 })} onOpen={vi.fn()} />);
    expect(bell().getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("notifications-bell-count").textContent).toBe("2");
  });
});
