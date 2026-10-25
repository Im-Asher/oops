import { describe, expect, it } from "vitest";
import { toUIMessage } from "./transcript";

describe("toUIMessage", () => {
  it("纯文本消息重建为单文本 part", () => {
    const msg = toUIMessage("m1", "user", "你好", undefined);
    expect(msg).toEqual({ id: "m1", role: "user", parts: [{ type: "text", text: "你好" }] });
  });

  it("助手消息：文本 + 生图工具结果重建为图片 part（零转换，可直接渲染）", () => {
    const msg = toUIMessage("m2", "assistant", "已生成", [
      {
        type: "generate_image",
        url: "/files/assets/x.png",
        assetId: "a1",
        prompt: "苹果",
        model: "wan2.7-image",
        size: "1024*1024",
      },
    ]);
    expect(msg.parts).toContainEqual({
      type: "image",
      url: "/files/assets/x.png",
      assetId: "a1",
      prompt: "苹果",
      model: "wan2.7-image",
      size: "1024*1024",
    });
  });

  it("未声明的工具类型不产生额外 part", () => {
    const msg = toUIMessage("m3", "assistant", "完成", [{ type: "other", url: "/x" }]);
    expect(msg.parts).toEqual([{ type: "text", text: "完成" }]);
  });

  it("画布导出消息（edited_image）同样重建为图片 part，且 sourceAssetId 不影响渲染", () => {
    const msg = toUIMessage("m4", "assistant", "已导出为新图片", [
      {
        type: "edited_image",
        url: "/files/assets/y.png",
        assetId: "a2",
        sourceAssetId: "a0",
      },
    ]);
    expect(msg.parts).toContainEqual({
      type: "image",
      url: "/files/assets/y.png",
      assetId: "a2",
    });
    // sourceAssetId 不进入前端 part（聊天与画布不展示派生标识）。
    const imagePart = msg.parts.find((p) => p.type === "image");
    expect((imagePart as { sourceAssetId?: string }).sourceAssetId).toBeUndefined();
  });

  it("海报渲染结果（render_html）重建为图片 part（与生图同等地位，可选中引用）", () => {
    const msg = toUIMessage("m5", "assistant", "海报已生成", [
      {
        type: "render_html",
        url: "/files/poster.png",
        assetId: "a3",
        width: 750,
        height: 1334,
        taskId: "t9",
      },
    ]);
    expect(msg.parts).toContainEqual({
      type: "image",
      url: "/files/poster.png",
      assetId: "a3",
    });
  });

  it("present_options 工具结果重建为可点击 options part（刷新后仍可点）", () => {
    const msg = toUIMessage("m6", "assistant", "请选择海报用途", [
      {
        type: "present_options",
        question: "海报主要用在哪里？",
        options: [{ label: "促销主图" }, { label: "上新海报", description: "新品上架推广" }],
      },
    ]);
    expect(msg.parts).toEqual([
      { type: "text", text: "请选择海报用途" },
      {
        type: "options",
        question: "海报主要用在哪里？",
        options: [{ label: "促销主图" }, { label: "上新海报", description: "新品上架推广" }],
      },
    ]);
  });

  it("present_options 坏数据（缺 question/options、空 label 项）整块忽略不抛错", () => {
    const msg = toUIMessage("m7", "assistant", "收尾文本", [
      { type: "present_options", options: [{ label: "a" }, { label: "b" }] }, // 缺 question
      { type: "present_options", question: "q" }, // 缺 options
      { type: "present_options", question: "q", options: [{ label: "" }, {}] }, // 全部非法 label
      { type: "present_options", question: "q", options: [{ label: "有效" }, { label: "" }] }, // 部分非法
    ]);
    expect(msg.parts).toEqual([
      { type: "text", text: "收尾文本" },
      { type: "options", question: "q", options: [{ label: "有效" }] },
    ]);
  });
});
