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
});
