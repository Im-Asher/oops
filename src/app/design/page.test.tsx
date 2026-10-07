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

/** 画布元素计数：限定画布 surface，避免把模版面板缩略图里的元素算进来。 */
function canvasElementCount(): number {
  return document.querySelectorAll('[data-testid="design-canvas-surface"] [data-design-element]').length;
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

describe("设计页左栏 rail 与模版面板", () => {
  it("rail 三入口渲染：模版可用，文字/素材先行禁用；模版面板默认展开含缩略图", () => {
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-rail-templates").hasAttribute("disabled")).toBe(false);
    expect((screen.getByTestId("design-rail-text") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("design-rail-materials") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("design-panel")).toBeTruthy();
    // 缩略图由模版 JSON 实时渲染：卡片内出现模版元素节点
    const thumb = screen.getByTestId("design-template-ecom-main");
    expect(thumb.querySelectorAll("[data-design-element]").length).toBeGreaterThan(0);
    expect(screen.getByTestId("design-template-xhs-cover")).toBeTruthy();
  });

  it("点击模版：等比加载进画布（进历史），撤销回空画布", () => {
    renderWithI18n(<DesignPage />);
    expect(canvasElementCount()).toBe(0);

    fireEvent.click(screen.getByTestId("design-template-ecom-main"));
    const count = canvasElementCount();
    expect(count).toBeGreaterThan(0);

    // 加载进历史：撤销 → 空画布，重做 → 恢复
    const undo = screen.getByTestId("design-undo") as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(canvasElementCount()).toBe(0);
    fireEvent.click(screen.getByTestId("design-redo"));
    expect(canvasElementCount()).toBe(count);
  });

  it("重复加载同一模版：元素 id 重新生成，不产生 key/id 冲突", () => {
    renderWithI18n(<DesignPage />);
    fireEvent.click(screen.getByTestId("design-template-ecom-main"));
    const first = canvasElementCount();
    fireEvent.click(screen.getByTestId("design-template-ecom-main"));
    const second = canvasElementCount();
    expect(second).toBe(first);
    const ids = Array.from(
      document.querySelectorAll('[data-testid="design-canvas-surface"] [data-design-element]'),
    ).map((el) => el.getAttribute("data-design-element"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("再点当前激活 rail 入口：收起面板", () => {
    renderWithI18n(<DesignPage />);
    expect(screen.getByTestId("design-panel")).toBeTruthy();
    fireEvent.click(screen.getByTestId("design-rail-templates"));
    expect(screen.queryByTestId("design-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("design-rail-templates"));
    expect(screen.getByTestId("design-panel")).toBeTruthy();
  });
});

