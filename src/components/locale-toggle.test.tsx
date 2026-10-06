// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE } from "@/i18n/messages";
import { renderWithI18n } from "@/test/render-with-i18n";
import { LocaleToggle } from "./locale-toggle";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function currentLocaleCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
    ?.split("=")[1];
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  document.cookie = `${LOCALE_COOKIE}=; max-age=0; path=/`;
});

describe("LocaleToggle", () => {
  it("zh 下点击写入 cookie=en 并触发路由刷新", async () => {
    renderWithI18n(<LocaleToggle />);
    await userEvent.click(screen.getByRole("button", { name: "切换语言" }));
    expect(currentLocaleCookie()).toBe("en");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("en 下点击写入 cookie=zh", async () => {
    renderWithI18n(<LocaleToggle />, { locale: "en" });
    await userEvent.click(screen.getByRole("button", { name: "切换语言" }));
    expect(currentLocaleCookie()).toBe("zh");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
