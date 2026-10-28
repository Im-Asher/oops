import { describe, expect, it } from "vitest";
import type { Messages } from "@/i18n/messages";
import { resolvePresets } from "./presets";

// 「definitions 的 preset key 都能在 zh/en 词典解析」这条跨端一致性用例已随
// definitions 搬到 apps/creation/src/agent/definitions.guard.test.ts：key 的一手
// 来源在创作域，那里直接读 web 的词典文件做防漂移断言。

/** 局部词典夹具：只含 presets 相关分支（类型断言后供被测函数使用）。 */
const zhMessages = {
  chat: {
    presets: {
      "atmosphere-designer": {
        autumnWood: "生成一张秋天树林里木桌旁的场景氛围图，暖色调逆光",
      },
    },
  },
} as unknown as Messages;

const enMessages = {
  chat: {
    presets: {
      "atmosphere-designer": {
        autumnWood: "Generate a cozy autumn scene with a wooden table in the forest, warm backlit tones",
      },
    },
  },
} as unknown as Messages;

describe("resolvePresets", () => {
  it("zh 词典 → 与 definitions 原文案一致的中文灵感卡", () => {
    expect(resolvePresets(zhMessages, "atmosphere-designer", ["autumnWood"])).toEqual([
      "生成一张秋天树林里木桌旁的场景氛围图，暖色调逆光",
    ]);
  });

  it("en 词典 → 英文撰写的示例 prompt（非直译口径由词典评审保证）", () => {
    const [text] = resolvePresets(enMessages, "atmosphere-designer", ["autumnWood"]);
    expect(text).toMatch(/^Generate /);
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("未登记的 agentId → key 数组原样透传", () => {
    expect(resolvePresets(zhMessages, "unknown-agent", ["a", "b"])).toEqual(["a", "b"]);
  });

  it("表内缺 key → 该项透传 key（其余正常解析）", () => {
    expect(resolvePresets(zhMessages, "atmosphere-designer", ["autumnWood", "missingKey"])).toEqual([
      "生成一张秋天树林里木桌旁的场景氛围图，暖色调逆光",
      "missingKey",
    ]);
  });
});
