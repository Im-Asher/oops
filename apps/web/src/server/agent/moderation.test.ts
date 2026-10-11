import { describe, expect, it } from "vitest";
import { screenInput } from "./moderation";

describe("screenInput", () => {
  it("无命中返回 null", () => {
    expect(screenInput("画一颗苹果", [/禁用词/])).toBeNull();
  });

  it("命中返回拦截原因", () => {
    const reason = screenInput("包含禁用词的内容", [/禁用词/]);
    expect(reason).not.toBeNull();
  });

  it("默认空名单不拦截任何输入", () => {
    expect(screenInput("任何内容")).toBeNull();
  });
});
