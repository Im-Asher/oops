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
    textElement({ content: "标题", x: 40, y: 40, w: 200, h: 48 }),
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
