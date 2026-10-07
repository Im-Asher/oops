// @vitest-environment jsdom
/**
 * 设计页壳测试：URL/草稿初始化与返回链接（4.1）+
 * 顶栏撤销/重做（4.5）：禁用态由历史栈驱动，多步回退链经真实 UI
 * 事件（拖动 → 顶栏按钮）往返验证；reducer 层 undo/redo 语义已在
 * design-reducer.test.ts 覆盖，此处只测接入。
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignElement } from "@/lib/design/doc";
import { shapeElement, textElement } from "@/lib/design/elements";
import { renderWithI18n } from "@/test/render-with-i18n";
import DesignPage from "./page";

const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/design",
}));

// jsdom 无 pointer capture 实现（同 design-canvas.test 约定）。
beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

beforeEach(() => {
  window.localStorage.clear();
  searchParams.delete("w");
  searchParams.delete("h");
});

afterEach(() => {
  cleanup();
});

function seedDraft(elements: DesignElement[]) {
  localStorage.setItem(
    "oops:design:draft:v1",
    JSON.stringify({ version: 1, width: 800, height: 800, background: "#ffffff", elements }),
  );
}

function elementEl(id: string): HTMLElement {
  return document.querySelector(`[data-design-element="${id}"]`) as HTMLElement;
}

function pos(id: string): { x: string; y: string } {
  const el = elementEl(id);
  return { x: el.style.left, y: el.style.top };
}

/** jsdom rect 全 0：client 坐标即画布坐标（同 design-canvas.test 约定）。 */
function drag(id: string, from: { x: number; y: number }, to: { x: number; y: number }, pointerId: number) {
  const el = elementEl(id);
  fireEvent.pointerDown(el, { button: 0, clientX: from.x, clientY: from.y, pointerId });
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId });
  fireEvent.pointerUp(el, { pointerId });
}

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

describe("设计页顶栏撤销/重做", () => {
  it("初始无历史：撤销/重做均禁用", () => {
    seedDraft([textElement({ id: "e1", content: "标题", x: 40, y: 40, w: 300, h: 80, fontSize: 40 })]);
    renderWithI18n(<DesignPage />);
    expect((screen.getByTestId("design-undo") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("design-redo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("撤销")).toBeTruthy();
    expect(screen.getByLabelText("重做")).toBeTruthy();
  });

  it("两步移动经顶栏逐次撤销回到初始，再逐次重做，禁用态随之切换", () => {
    seedDraft([textElement({ id: "e1", content: "标题", x: 40, y: 40, w: 300, h: 80, fontSize: 40 })]);
    renderWithI18n(<DesignPage />);
    const undo = screen.getByTestId("design-undo") as HTMLButtonElement;
    const redo = screen.getByTestId("design-redo") as HTMLButtonElement;

    drag("e1", { x: 60, y: 60 }, { x: 160, y: 160 }, 1); // → (140,140)
    drag("e1", { x: 160, y: 140 }, { x: 260, y: 140 }, 2); // → (240,140)
    expect(pos("e1")).toEqual({ x: "240px", y: "140px" });
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);

    fireEvent.click(undo);
    expect(pos("e1")).toEqual({ x: "140px", y: "140px" });
    fireEvent.click(undo);
    expect(pos("e1")).toEqual({ x: "40px", y: "40px" });
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    expect(pos("e1")).toEqual({ x: "140px", y: "140px" });
    fireEvent.click(redo);
    expect(pos("e1")).toEqual({ x: "240px", y: "140px" });
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);
  });

  it("删除后顶栏撤销恢复元素（回退链覆盖删除动作）", () => {
    seedDraft([
      textElement({ id: "e1", content: "标题", x: 40, y: 40, w: 300, h: 80, fontSize: 40 }),
      shapeElement({ id: "e2", kind: "rect", fill: "#e5e7eb", x: 500, y: 500, w: 100, h: 100 }),
    ]);
    renderWithI18n(<DesignPage />);
    const undo = screen.getByTestId("design-undo") as HTMLButtonElement;

    fireEvent.pointerDown(elementEl("e1"), { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    const canvas = document.querySelector('[role="application"]') as HTMLElement;
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(elementEl("e1")).toBeNull();

    fireEvent.click(undo);
    expect(elementEl("e1")).not.toBeNull();
    expect(elementEl("e2")).not.toBeNull();
  });
});
