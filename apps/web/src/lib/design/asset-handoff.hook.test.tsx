// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetHandoff } from "./asset-handoff";

/**
 * 覆盖两种重复插入场景：
 * 1. StrictMode 双跑 —— 同一挂载周期内effect 跑两次
 * 2. 草稿恢复 —— 刷新后 URL 的 assetId 未变但稿件里已有该图
 * 以及资产缺失时的降级。
 */

const h = vi.hoisted(() => ({
  status: 200,
  item: {
    id: "a1",
    url: "/files/e2e/a.png",
    width: 800,
    height: 600,
  } as { id: string; url: string; width: number | null; height: number | null } | null,
}));

beforeEach(() => {
  h.status = 200;
  h.item = { id: "a1", url: "/files/e2e/a.png", width: 800, height: 600 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: h.status >= 200 && h.status < 300,
      status: h.status,
      json: async () => ({ item: h.item }),
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

const canvasSize = { width: 800, height: 800 };
const getViewportCenter = () => ({ x: 400, y: 400 });
/** 默认稿件为空（没有同 src 图层）。 */
const emptyDraft = () => true;

describe("useAssetHandoff", () => {
  it("取到资产后插入图层，宽高按资产比例换算", async () => {
    const onInsert = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: "a1",
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert,
        onMissing: vi.fn(),
      }),
    );
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    const el = onInsert.mock.calls[0]![0] as { src: string; w: number; h: number };
    expect(el.src).toBe("/files/e2e/a.png");
    expect(el.w / el.h).toBeCloseTo(800 / 600, 2);
  });

  it("同一次挂载内重复触发 effect 不会重复插入", async () => {
    // 说明：本用例验证「已处理过的 assetId 不再插入」这一去重契约本身。
    // StrictMode 的双跑（mount → cleanup → 再次 mount）在 vitest 的 renderHook 下
    // 并不会真实发生——实测移除 insertedRef 后本用例仍通过，说明这里只跑了
    // 一次 effect。StrictMode 场景由浏览器端验证（同一 assetId 刷新三次，
    // 图片图层稳定为 1 个），单测层面无法可靠复现，故不在此假装覆盖。
    const onInsert = vi.fn();
    const { rerender } = renderHook(() =>
      useAssetHandoff({
        assetId: "a1",
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert,
        onMissing: vi.fn(),
      }),
    );
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("草稿里已有同 src 图层时跳过插入（刷新不重复累积）", async () => {
    const onInsert = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: "a1",
        canvasSize,
        getViewportCenter,
        // 模拟草稿恢复后稿件已含该图
        shouldInsert: () => false,
        onInsert,
        onMissing: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("资产不存在（404）走 onMissing，不插入也不抛错", async () => {
    h.status = 404;
    const onInsert = vi.fn();
    const onMissing = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: "gone",
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert,
        onMissing,
      }),
    );
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("响应体无 item 时走 onMissing", async () => {
    h.item = null;
    const onInsert = vi.fn();
    const onMissing = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: "a1",
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert,
        onMissing,
      }),
    );
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("网络异常走 onMissing，不白屏", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const onMissing = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: "a1",
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert: vi.fn(),
        onMissing,
      }),
    );
    await waitFor(() => expect(onMissing).toHaveBeenCalledTimes(1));
  });

  it("无 assetId 时完全不发请求", async () => {
    const onInsert = vi.fn();
    renderHook(() =>
      useAssetHandoff({
        assetId: null,
        canvasSize,
        getViewportCenter,
        shouldInsert: emptyDraft,
        onInsert,
        onMissing: vi.fn(),
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(fetch).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });
});

// --- 辅助 ---