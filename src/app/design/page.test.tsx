// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import DesignPage from "./page";

const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/design",
}));

beforeEach(() => {
  window.localStorage.clear();
  searchParams.delete("w");
  searchParams.delete("h");
});

afterEach(() => {
  cleanup();
});

describe("设计页壳", () => {
  it("URL 携带 w/h：新建该尺寸画布，并清除旧草稿", () => {
    window.localStorage.setItem("oops:design:draft:v1", JSON.stringify({ version: 1, width: 1, height: 1, background: "#fff", elements: [] }));
    searchParams.set("w", "900");
    searchParams.set("h", "1200");
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-canvas-size").textContent).toBe("900 × 1200 px");
    expect(window.localStorage.getItem("oops:design:draft:v1")).toBeNull();
  });

  it("无参数：恢复本机草稿尺寸", () => {
    window.localStorage.setItem(
      "oops:design:draft:v1",
      JSON.stringify({ version: 1, width: 500, height: 400, background: "#fff", elements: [] }),
    );
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-canvas-size").textContent).toBe("500 × 400 px");
  });

  it("无参数无草稿：默认 800 × 800 空白", () => {
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-canvas-size").textContent).toBe("800 × 800 px");
  });

  it("非法参数：回落默认尺寸", () => {
    searchParams.set("w", "0");
    searchParams.set("h", "99999");
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-canvas-size").textContent).toBe("800 × 800 px");
  });

  it("返回首页链接可达", () => {
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-back").getAttribute("href")).toBe("/home");
  });
});
