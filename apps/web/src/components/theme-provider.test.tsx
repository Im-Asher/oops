// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { ThemeProvider, ThemeToggle, useTheme } from "./theme-provider";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeProvider", () => {
  it("挂载后从 localStorage 同步持久化主题", () => {
    localStorage.setItem("oops-theme", "light");
    let observed = "";
    function Probe() {
      observed = useTheme().theme;
      return null;
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(observed).toBe("light");
  });

  it("无存储时回退默认亮色", () => {
    let observed = "";
    function Probe() {
      observed = useTheme().theme;
      return null;
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(observed).toBe("light");
  });
});

describe("ThemeToggle", () => {
  it("点击切换 html class 与 localStorage", async () => {
    const user = userEvent.setup();
    // 默认亮色：先切暗再切回，两个方向都覆盖
    renderWithI18n(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "切换为暗色模式" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("oops-theme")).toBe("dark");
    await user.click(screen.getByRole("button", { name: "切换为亮色模式" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("oops-theme")).toBe("light");
  });
});
