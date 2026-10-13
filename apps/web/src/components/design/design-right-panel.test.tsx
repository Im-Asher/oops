// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignRightPanel } from "@/components/design/design-right-panel";
import { createDesignState, type DesignState } from "@/lib/design/design-reducer";
import type { DesignDoc, ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";
import { renderWithI18n } from "@/test/render-with-i18n";

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const text: TextElement = {
  id: "t1",
  type: "text",
  x: 10,
  y: 20,
  w: 200,
  h: 40,
  rotation: 0,
  opacity: 1,
  content: "标题",
  fontFamily: "'Smiley Sans'",
  fontSize: 32,
  fontWeight: 400,
  color: "#111111",
  align: "left",
  lineHeight: 1.2,
  background: null,
};

const image: ImageElement = {
  id: "i1",
  type: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  opacity: 0.8,
  src: "/design-materials/star.svg",
  fit: "cover",
  radius: 0,
};

const shape: ShapeElement = {
  id: "s1",
  type: "shape",
  x: 5,
  y: 5,
  w: 50,
  h: 50,
  rotation: 0,
  opacity: 1,
  kind: "rect",
  fill: "#3b82f6",
  radius: 8,
};

const doc: DesignDoc = {
  version: 1,
  width: 800,
  height: 800,
  background: "#ffffff",
  elements: [text, image, shape],
};

function renderPanel(state: DesignState) {
  const dispatch = vi.fn();
  renderWithI18n(<DesignRightPanel dispatch={dispatch} state={state} />);
  return dispatch;
}

function selectAll(ids: string[]): DesignState {
  return { ...createDesignState(doc), selection: ids };
}

/** 取色器/数字输入的完整提交流（focus 快照 + input 连续 patch）。 */
function fill(testId: string, value: string) {
  const input = screen.getByTestId(testId) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value } });
}

describe("DesignRightPanel 画布属性（无选中）", () => {
  it("显示画布尺寸只读与背景色", () => {
    renderPanel(createDesignState(doc));
    expect(screen.getByTestId("design-props-canvas-size").textContent).toBe("800 × 800 px");
    expect((screen.getByTestId("design-props-background-picker") as HTMLInputElement).value).toBe("#ffffff");
  });

  it("色板点击背景色单步入历史（setCanvas）", () => {
    const dispatch = renderPanel(createDesignState(doc));
    fireEvent.click(screen.getByRole("button", { name: "#ef4444" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setCanvas",
      patch: { background: "#ef4444" },
    });
  });

  it("取色器连续变更：focus 快照 + 无历史 patch", () => {
    const dispatch = renderPanel(createDesignState(doc));
    fill("design-props-background-picker", "#22c55e");
    expect(dispatch.mock.calls[0][0]).toEqual({ type: "beginHistory" });
    expect(dispatch.mock.calls[1][0]).toEqual({
      type: "setCanvas",
      history: false,
      patch: { background: "#22c55e" },
    });
  });
});

describe("DesignRightPanel 文本属性", () => {
  it("几何数值输入：focus 快照 + patch 无历史", () => {
    const dispatch = renderPanel(selectAll(["t1"]));
    fill("design-props-font-size", "48");
    expect(dispatch.mock.calls[0][0]).toEqual({ type: "beginHistory" });
    expect(dispatch.mock.calls[1][0]).toEqual({
      type: "patchElements",
      history: false,
      patches: [{ id: "t1", patch: { fontSize: 48 } }],
    });
  });

  it("对齐按钮：单步 patch 入历史", () => {
    const dispatch = renderPanel(selectAll(["t1"]));
    fireEvent.click(screen.getByTestId("design-props-align-center"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "patchElements",
      history: true,
      patches: [{ id: "t1", patch: { align: "center" } }],
    });
  });

  it("层级按钮：reorder front", () => {
    const dispatch = renderPanel(selectAll(["t1"]));
    fireEvent.click(screen.getByTestId("design-props-layer-front"));
    expect(dispatch).toHaveBeenCalledWith({ type: "reorder", mode: "front" });
  });
});

describe("DesignRightPanel 图片与形状属性", () => {
  it("图片适配切换 patch fit；透明度 0-100 存 0..1", () => {
    const dispatch = renderPanel(selectAll(["i1"]));
    fireEvent.click(screen.getByTestId("design-props-fit-contain"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "patchElements",
      history: true,
      patches: [{ id: "i1", patch: { fit: "contain" } }],
    });
    fill("design-props-opacity", "50");
    expect(dispatch.mock.calls.at(-1)![0]).toEqual({
      type: "patchElements",
      history: false,
      patches: [{ id: "i1", patch: { opacity: 0.5 } }],
    });
  });

  it("形状色板填充 patch fill", () => {
    const dispatch = renderPanel(selectAll(["s1"]));
    fireEvent.click(screen.getByRole("button", { name: "#ef4444" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "patchElements",
      history: true,
      patches: [{ id: "s1", patch: { fill: "#ef4444" } }],
    });
  });
});

describe("DesignRightPanel 多选", () => {
  it("仅显示层级区：整组前/后可用，逐层禁用", () => {
    renderPanel(selectAll(["t1", "i1"]));
    expect(screen.queryByTestId("design-props-canvas-size")).toBeNull();
    expect(screen.queryByTestId("design-props-x")).toBeNull();
    expect((screen.getByTestId("design-props-layer-front") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("design-props-layer-forward") as HTMLButtonElement).disabled).toBe(true);
  });
});
