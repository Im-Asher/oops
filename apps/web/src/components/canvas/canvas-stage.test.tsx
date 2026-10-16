// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FILTERS,
  initialCanvasState,
  type CanvasItem,
} from "@/lib/canvas/canvas-reducer";
import { renderWithI18n } from "@/test/render-with-i18n";

import { CanvasStage } from "./canvas-stage";

/**
 * 生成三态占位卡回归（change add-landing-page 任务 3.4）：
 * 语义层换色不得影响生成中 / 失败卡的结构与交互。402（积分耗尽）的
 * composer 禁用回归在 components/chat/composer.test.tsx。
 */
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function item(overrides: Partial<CanvasItem> = {}): CanvasItem {
  return {
    id: "i1",
    assetId: "a1",
    url: "",
    x: 0,
    y: 0,
    width: 200,
    aspect: 1,
    status: "image",
    edit: { crop: null, filters: { ...DEFAULT_FILTERS } },
    ...overrides,
  };
}

function renderStage(items: CanvasItem[], onRetryItem?: (item: CanvasItem) => void) {
  return renderWithI18n(
    <CanvasStage
      dispatch={vi.fn()}
      exportError={null}
      onResetEdits={vi.fn()}
      onRetryItem={onRetryItem}
      state={{ ...initialCanvasState, items }}
    />,
  );
}

describe("CanvasStage 生成三态占位卡", () => {
  it("generating：生成中占位 + prompt 预览，无重试入口", () => {
    renderStage([item({ status: "generating", prompt: "a cat in space" })]);
    expect(screen.getByText("生成中…")).toBeTruthy();
    expect(screen.getByText("a cat in space")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试生成" })).toBeNull();
  });

  it("failed：失败卡 + 错误信息透传，重试回调携带原条目", () => {
    const onRetry = vi.fn();
    const failed = item({ status: "failed", prompt: "a cat", errorMessage: "boom" });
    renderStage([failed], onRetry);
    expect(screen.getByText("生成失败")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试生成" }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });
});
