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
});
