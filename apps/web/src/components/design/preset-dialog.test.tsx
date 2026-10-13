// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { PresetDialog } from "./preset-dialog";

const push = vi.fn();
const onOpenChange = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const RECENT_KEY = "oops:design:recent-sizes:v1";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog() {
  return renderWithI18n(<PresetDialog onOpenChange={onOpenChange} open />);
}

describe("尺寸前置设置弹窗", () => {
  it("预设点击：跳转 /design 携带尺寸，并记录最近使用", async () => {
    renderDialog();
    await userEvent.click(await screen.findByTestId("design-preset-main-image"));
    expect(push).toHaveBeenCalledWith("/design?w=800&h=800");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const recent = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    expect(recent[0]).toEqual({ width: 800, height: 800 });
  });

  it("分类切换：社交媒体只显示该组预设", async () => {
    renderDialog();
    await userEvent.click(await screen.findByTestId("design-category-social"));
    expect(screen.getByTestId("design-preset-xhs-cover")).toBeTruthy();
    expect(screen.queryByTestId("design-preset-main-image")).toBeNull();
  });

  it("自定义尺寸：合法创建跳转且不记录最近使用；非法时创建禁用", async () => {
    renderDialog();
    await userEvent.type(await screen.findByLabelText("宽"), "900");
    await userEvent.type(screen.getByLabelText("高"), "1200");
    await userEvent.click(screen.getByTestId("design-create-custom"));
    expect(push).toHaveBeenCalledWith("/design?w=900&h=1200");
    expect(window.localStorage.getItem(RECENT_KEY)).toBeNull();

    cleanup();
    renderDialog();
    const create = await screen.findByTestId("design-create-custom") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("宽"), "0");
    expect(create.disabled).toBe(true);
  });

  it("锁定比例：改宽同步高（900×1200 锁定后改宽 600 → 高 800）", async () => {
    renderDialog();
    await userEvent.type(await screen.findByLabelText("宽"), "900");
    await userEvent.type(screen.getByLabelText("高"), "1200");
    await userEvent.click(screen.getByRole("button", { name: "锁定比例" }));
    await userEvent.clear(screen.getByLabelText("宽"));
    await userEvent.type(screen.getByLabelText("宽"), "600");
    await waitFor(() => {
      expect((screen.getByLabelText("高") as HTMLInputElement).value).toBe("800");
    });
  });

  it("最近使用：预设创建后出现在最近列表并可直接再次创建", async () => {
    renderDialog();
    await userEvent.click(await screen.findByTestId("design-preset-xhs-cover"));
    expect(push).toHaveBeenCalledWith("/design?w=1242&h=1656");

    cleanup();
    renderDialog();
    await userEvent.click(await screen.findByText("最近使用"));
    await userEvent.click(screen.getByTestId("design-recent-1242x1656"));
    expect(push).toHaveBeenCalledWith("/design?w=1242&h=1656");
  });
});
