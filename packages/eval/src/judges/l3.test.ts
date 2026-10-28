import { describe, expect, it } from "vitest";
import { judgeL3 } from "./l3";

const vlm = (text: string) => async () => text;

describe("judgeL3", () => {
  it("DOM 有、图里也能读到 → 通过", async () => {
    const r = await judgeL3({
      domText: "恒温 12 小时",
      mustContain: ["恒温 12 小时"],
      image: new Uint8Array([1]),
      vlm: vlm("海报文字：恒温 12 小时"),
    });
    expect(r.failures).toEqual([]);
  });

  it("DOM 有、图里读不到 → missing_glyph", async () => {
    const r = await judgeL3({
      domText: "桓台𠮷字",
      mustContain: ["𠮷"],
      image: new Uint8Array([1]),
      vlm: vlm("海报文字：桓台 字"),
    });
    expect(r.failures.map((f) => f.code)).toContain("missing_glyph");
  });

  it("DOM 里就没有 → text_missing", async () => {
    const r = await judgeL3({
      domText: "别的内容",
      mustContain: ["恒温 12 小时"],
      image: new Uint8Array([1]),
      vlm: vlm("别的内容"),
    });
    expect(r.failures.map((f) => f.code)).toContain("text_missing");
  });

  it("mustContain 为空时直接通过，且不调用 VLM", async () => {
    let called = false;
    const r = await judgeL3({
      domText: "任意",
      mustContain: [],
      image: new Uint8Array([1]),
      vlm: async () => {
        called = true;
        return "";
      },
    });
    expect(r.pass).toBe(true);
    expect(called).toBe(false);
  });
});
