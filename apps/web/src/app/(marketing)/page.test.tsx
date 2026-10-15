// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/test/render-with-i18n";

import LandingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const ORDER = ["nav","hero","slice","agents","how","compare","faq","closing","footer"];

describe("LandingPage", () => {
  it("renders sections in fixed order", () => {
    renderWithI18n(<LandingPage />);
    const sections = document.querySelectorAll("[data-landing-section]");
    expect([...sections].map((s) => s.getAttribute("data-landing-section"))).toEqual(ORDER);
  });

  it("gradient CTA 只出现在 hero 与 closing，且为同一转化动作", () => {
    renderWithI18n(<LandingPage />);
    const ctas = [...document.querySelectorAll("[data-cta-variant='gradient']")] as HTMLAnchorElement[];
    const sections = ctas.map((c) => c.closest("[data-landing-section]")?.getAttribute("data-landing-section"));
    // B7.1.1：每个视口至多一个渐变 CTA，收尾复用首屏动作（同 target，不另设动作）
    expect(sections).toEqual(["hero", "closing"]);
    expect(new Set(ctas.map((c) => c.getAttribute("href")))).toEqual(new Set(["/register"]));
  });
});
