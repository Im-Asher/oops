import { describe, expect, it } from "vitest";
import { collectFromEvents } from "./run";

const events = [
  { type: "message_delta", text: "好的" },
  { type: "tool_start", id: "t1", name: "render_html", args: { html: "<html></html>", height: 1334 } },
  { type: "tool_end", id: "t1", name: "render_html", details: { assetId: "a1", url: "/files/p.png", width: 750, height: 1334 } },
  { type: "finish", stopReason: "end" },
];

describe("collectFromEvents", () => {
  it("提取 render_html 的 html 与产物", () => {
    const r = collectFromEvents(events as never);
    expect(r.html).toBe("<html></html>");
    expect(r.assetUrl).toBe("/files/p.png");
    expect(r.size).toEqual([750, 1334]);
    expect(r.toolErrors).toEqual([]);
  });

  it("工具失败进入 toolErrors", () => {
    const r = collectFromEvents([
      { type: "tool_end", id: "t1", name: "render_html", details: { error: "render_failed", message: "boom" } },
    ] as never);
    expect(r.toolErrors[0]).toMatchObject({ code: "render_failed" });
  });

  it("generate_image 也产出 assetUrl", () => {
    const r = collectFromEvents([
      { type: "tool_end", id: "t", name: "generate_image", details: { url: "/files/g.png", width: 768, height: 1344 } },
    ] as never);
    expect(r.assetUrl).toBe("/files/g.png");
    expect(r.size).toEqual([768, 1344]);
  });
});
