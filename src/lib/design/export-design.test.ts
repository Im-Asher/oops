// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapdom } from "@zumer/snapdom";
import { downloadBlob, exportDesignToBlob } from "@/lib/design/export-design";

vi.mock("@zumer/snapdom", () => ({
  snapdom: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exportDesignToBlob", () => {
  it("await fonts.ready 后以 scale=1 截图 surface，导出 PNG Blob", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const toBlob = vi.fn(async () => blob);
    vi.mocked(snapdom).mockResolvedValue({ toBlob } as never);

    const node = document.createElement("div");
    const result = await exportDesignToBlob(node, { width: 800, height: 800 });

    expect(result).toBe(blob);
    expect(snapdom).toHaveBeenCalledWith(node, { width: 800, height: 800 });
    expect(toBlob).toHaveBeenCalledWith({ format: "png" });
  });

  it("snapdom/toBlob 抛错时向上传播（UI 层负责就地提示）", async () => {
    vi.mocked(snapdom).mockRejectedValue(new Error("boom"));
    await expect(exportDesignToBlob(document.createElement("div"), { width: 800, height: 800 })).rejects.toThrow("boom");
  });
});

describe("downloadBlob", () => {
  it("创建 objectURL 触发 a[download] 点击并回收 URL", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:mock", revokeObjectURL });
    let clickedAnchor: HTMLAnchorElement | null = null;
    const onClick = (event: Event) => {
      clickedAnchor = event.target as HTMLAnchorElement;
    };
    document.addEventListener("click", onClick, { once: true });

    const blob = new Blob(["x"], { type: "image/png" });
    downloadBlob(blob, "design-800x800.png");

    expect(clickedAnchor).not.toBeNull();
    expect(clickedAnchor!.download).toBe("design-800x800.png");
    expect(clickedAnchor!.href).toContain("blob:mock");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    // a 元素已从 DOM 移除（一次性节点）
    expect(document.querySelectorAll("a[download]").length).toBe(0);
  });
});
