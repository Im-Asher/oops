// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useReducer } from "react";
import { DesignCanvas } from "./design-canvas";
import { textElement, shapeElement } from "@/lib/design/elements";
import { createEmptyDoc, type DesignDoc } from "@/lib/design/doc";
import { createDesignState, designReducer, type DesignAction } from "@/lib/design/design-reducer";
import { renderWithI18n } from "@/test/render-with-i18n";

// jsdom 无 pointer capture 实现
beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

function docWith(): DesignDoc {
  const doc = createEmptyDoc(800, 600);
  doc.elements = [
    textElement({ content: "标题", fontSize: 24, x: 40, y: 40, w: 200, h: 48 }),
    shapeElement({ kind: "ellipse", fill: "#ff0000", x: 300, y: 300, w: 80, h: 80 }),
  ];
  return doc;
}

/** 受控挂载：真实 reducer 在测试闭包内推进，dispatch 同步驱动重渲染。 */
function mountCanvas(doc: DesignDoc = docWith()) {
  let state = createDesignState(doc);
  function Mount() {
    const [, force] = useReducer((n: number) => n + 1, 0);
    const dispatch = (action: DesignAction) => {
      state = designReducer(state, action);
      force();
    };
    return <DesignCanvas dispatch={dispatch} state={state} />;
  }
  renderWithI18n(<Mount />);
  return {
    getState: () => state,
    elements: () => screen.getAllByTestId("design-canvas-surface")[0].querySelectorAll("[data-design-element]"),
    handle: (id: string) =>
      screen.getAllByTestId("design-canvas-surface")[0].querySelector(`[data-handle="${id}"]`) as HTMLElement,
    surface: () => screen.getByTestId("design-canvas-surface"),
  };
}

describe("设计画布", () => {
  it("元素渲染：文本内容与形状节点出现在画布面内", () => {
    const { surface, elements } = mountCanvas();
    expect(surface().textContent).toContain("标题");
    expect(elements()).toHaveLength(2);
  });

  it("点击元素选中，点击背景取消选中", () => {
    const { elements, getState, surface } = mountCanvas();
    fireEvent.pointerDown(elements()[0], { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    expect(getState().selection).toHaveLength(1);
    fireEvent.pointerDown(surface(), { button: 0, clientX: 10, clientY: 10, pointerId: 2 });
    expect(getState().selection).toEqual([]);
  });

  it("拖动元素更新 x/y；pointerup 后一次撤销回到拖动前", () => {
    const { elements, getState } = mountCanvas();
    const el = elements()[0] as HTMLElement;
    fireEvent.pointerDown(el, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 30, pointerId: 1 });
    expect(getState().doc.elements[0].x).toBeCloseTo(90); // 40 + 50 / scale 1
    expect(getState().doc.elements[0].y).toBeCloseTo(70); // 40 + 30 / scale 1
    fireEvent.pointerUp(el, { pointerId: 1 });
    const undone = designReducer(getState(), { type: "undo" });
    expect(undone.doc.elements[0].x).toBe(40);
    expect(undone.doc.elements[0].y).toBe(40);
  });

  it("shift 多选后拖动整体移动", () => {
    const { elements, getState } = mountCanvas();
    fireEvent.pointerDown(elements()[0], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(elements()[0], { pointerId: 1 });
    fireEvent.pointerDown(elements()[1], { button: 0, clientX: 0, clientY: 0, pointerId: 2, shiftKey: true });
    fireEvent.pointerUp(elements()[1], { pointerId: 2 });
    expect(getState().selection).toHaveLength(2);
    // 拖动已在多选内的元素：全部选中元素整体移动
    fireEvent.pointerDown(elements()[0], { button: 0, clientX: 0, clientY: 0, pointerId: 3 });
    fireEvent.pointerMove(elements()[0], { clientX: 20, clientY: 10, pointerId: 3 });
    const [a, b] = getState().doc.elements;
    expect(a.x).toBeCloseTo(60); // 40 + 20
    expect(b.x).toBeCloseTo(320); // 300 + 20
  });

  it("Delete 键删除选中元素", () => {
    const { elements, getState } = mountCanvas();
    fireEvent.pointerDown(elements()[0], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(elements()[0], { pointerId: 1 });
    fireEvent.keyDown(screen.getByRole("application"), { key: "Delete" });
    expect(getState().doc.elements).toHaveLength(1);
  });
});

describe("设计画布选择框手柄", () => {
  /** 单选正方形文本元素（300,300 100×100 fontSize 20），返回挂载句柄。 */
  function mountSquare() {
    const doc = createEmptyDoc(800, 600);
    doc.elements = [textElement({ content: "A", fontSize: 20, x: 300, y: 300, w: 100, h: 100 })];
    const m = mountCanvas(doc);
    fireEvent.pointerDown(m.elements()[0], { button: 0, clientX: 350, clientY: 350, pointerId: 1 });
    return m;
  }

  it("单选渲染 8 向手柄与旋转柄；多选收敛为合并选择框", () => {
    const { elements, getState, surface } = mountCanvas();
    fireEvent.pointerDown(elements()[0], { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    expect(screen.getByTestId("design-handles")).toBeTruthy();
    expect(surface().querySelector('[data-handle="se"]')).toBeTruthy();
    expect(surface().querySelector('[data-handle="rotate"]')).toBeTruthy();
    expect(screen.queryByTestId("design-selection-box")).toBeNull();
    fireEvent.pointerDown(elements()[1], { button: 0, clientX: 0, clientY: 0, pointerId: 2, shiftKey: true });
    expect(getState().selection).toHaveLength(2);
    expect(screen.queryByTestId("design-handles")).toBeNull();
    expect(screen.getByTestId("design-selection-box")).toBeTruthy();
  });

  it("拖角手柄等比缩放：w/h/fontSize 同比放大，对面角锚定；一次撤销回滚", () => {
    const { getState, handle } = mountSquare();
    // se 手柄位于 (400,400)：沿对角拖到 (500,500) → 比例 ×2
    fireEvent.pointerDown(handle("se"), { button: 0, clientX: 400, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle("se"), { clientX: 500, clientY: 500, pointerId: 1 });
    const el = getState().doc.elements[0];
    expect(el.w).toBeCloseTo(200);
    expect(el.h).toBeCloseTo(200);
    expect(el.type === "text" ? el.fontSize : 0).toBeCloseTo(40);
    expect(el.x).toBeCloseTo(300); // nw 锚点固定
    expect(el.y).toBeCloseTo(300);
    fireEvent.pointerUp(handle("se"), { pointerId: 1 });
    const undone = designReducer(getState(), { type: "undo" });
    expect(undone.doc.elements[0].w).toBe(100);
    expect(undone.doc.elements[0].h).toBe(100);
  });

  it("拖边手柄单轴缩放：仅 w 变化，h/fontSize 不变", () => {
    const { getState, handle } = mountSquare();
    // e 手柄位于 (400,350)：向右拖 100 → w ×2
    fireEvent.pointerDown(handle("e"), { button: 0, clientX: 400, clientY: 350, pointerId: 1 });
    fireEvent.pointerMove(handle("e"), { clientX: 500, clientY: 350, pointerId: 1 });
    const el = getState().doc.elements[0];
    expect(el.w).toBeCloseTo(200);
    expect(el.h).toBe(100);
    expect(el.type === "text" ? el.fontSize : 0).toBe(20);
    expect(el.x).toBeCloseTo(300); // 左边固定
    fireEvent.pointerUp(handle("e"), { pointerId: 1 });
  });

  it("拖旋转手柄：以中心 atan2 计算角度增量", () => {
    const { getState, handle } = mountSquare();
    // pointer 在 (350,250)（元素正上方）→ 移到 (450,350)（正右方）：-90° → 0°
    fireEvent.pointerDown(handle("rotate"), { button: 0, clientX: 350, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(handle("rotate"), { clientX: 450, clientY: 350, pointerId: 1 });
    expect(getState().doc.elements[0].rotation).toBeCloseTo(90, 0);
    fireEvent.pointerUp(handle("rotate"), { pointerId: 1 });
    const undone = designReducer(getState(), { type: "undo" });
    expect(undone.doc.elements[0].rotation).toBe(0);
  });
});

describe("文本行内编辑", () => {
  /** 进入 e1 的编辑态（先 pointerdown 产生编辑提交依赖的历史快照，再双击）。 */
  function enterEdit(m: Pick<ReturnType<typeof mountCanvas>, "elements">) {
    const el = m.elements()[0] as HTMLElement;
    fireEvent.pointerDown(el, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    const span = el.querySelector("span") as HTMLElement;
    fireEvent.doubleClick(span);
    return span;
  }

  it("双击文本进入编辑态（contentEditable + 聚焦）", () => {
    const { elements } = mountCanvas();
    const span = enterEdit({ elements });
    expect(span.getAttribute("contenteditable")).toBe("true");
    expect(document.activeElement).toBe(span);
  });

  it("blur 提交内容；一次撤销回到改字前（单条历史）", () => {
    const m = mountCanvas();
    const span = enterEdit(m);
    span.textContent = "新标题";
    fireEvent.blur(span);
    expect((m.getState().doc.elements[0] as { content: string }).content).toBe("新标题");
    const undone = designReducer(m.getState(), { type: "undo" });
    expect((undone.doc.elements[0] as { content: string }).content).toBe("标题");
  });

  it("Esc 提交并退出编辑态", () => {
    const m = mountCanvas();
    const span = enterEdit(m);
    span.textContent = "Esc 提交";
    fireEvent.keyDown(span, { key: "Escape" });
    expect((m.getState().doc.elements[0] as { content: string }).content).toBe("Esc 提交");
    // contentEditable 为枚举属性：退出编辑渲染为 "false" 而非移除。
    expect(span.getAttribute("contenteditable")).toBe("false");
  });

  it("编辑中按键不冒泡到画布快捷键（Backspace 不删除元素）", () => {
    const m = mountCanvas();
    const span = enterEdit(m);
    fireEvent.keyDown(span, { key: "Backspace" });
    expect(m.getState().doc.elements).toHaveLength(2);
  });

  it("编辑中拖动该元素不产生移动（退出编辑前锁定移动会话）", () => {
    const m = mountCanvas();
    const span = enterEdit(m);
    const el = m.elements()[0] as HTMLElement;
    fireEvent.pointerDown(el, { button: 0, clientX: 50, clientY: 50, pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 150, clientY: 150, pointerId: 2 });
    expect(m.getState().doc.elements[0].x).toBe(40);
    fireEvent.blur(span);
  });

  it("双击形状元素不进入编辑", () => {
    const { elements } = mountCanvas();
    const shape = elements()[1] as HTMLElement;
    fireEvent.pointerDown(shape, { button: 0, clientX: 340, clientY: 340, pointerId: 1 });
    fireEvent.doubleClick(shape);
    expect(shape.querySelector("[contenteditable='true']")).toBeNull();
  });

  it("内容未变化时 blur 不产生历史快照", () => {
    const m = mountCanvas();
    const span = enterEdit(m);
    fireEvent.blur(span);
    expect(m.getState().past).toHaveLength(1); // 仅 pointerdown 的一次快照
  });
});
