import { describe, expect, it } from "vitest";
import zhMessagesJson from "../../../messages/zh.json";
import type { Messages } from "@/i18n/messages";
// 引入真实 definitions 触发注册（仅读 prompt 文件，无重依赖）
import "./definitions/atmosphere-designer";
import "./definitions/product-photographer";
import { agentRegistry } from "./registry";
import { resolvePresets } from "./presets";

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

  it("所有 definitions 的 preset key 均能在 zh 词典解析（防漂移：key 未登记会静默透传给用户）", () => {
    const realZh = zhMessagesJson as unknown as Messages;
    for (const agent of agentRegistry.list()) {
      const resolved = resolvePresets(realZh, agent.id, agent.presets);
      expect(resolved).toHaveLength(agent.presets.length);
      resolved.forEach((text, i) => {
        expect(text, `${agent.id}#${agent.presets[i]}`).not.toBe(agent.presets[i]);
      });
    }
  });
});
