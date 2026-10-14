// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "./page";

const ORDER = ["nav","hero","slice","agents","how","compare","faq","closing","footer"];

describe("LandingPage", () => {
  it("renders sections in fixed order", () => {
    render(<LandingPage />);
    const sections = document.querySelectorAll("[data-landing-section]");
    expect([...sections].map((s) => s.getAttribute("data-landing-section"))).toEqual(ORDER);
  });

  it("has at most one gradient CTA", () => {
    render(<LandingPage />);
    expect(document.querySelectorAll("[data-cta-variant='gradient']").length).toBeLessThanOrEqual(1);
  });
});
