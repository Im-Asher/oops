import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  objects: {} as Record<string, { body: number[]; contentType?: string }>,
}));

vi.mock("@/server/infra/storage/s3", () => ({
  defaultS3Client: {},
  createStorage: () => ({
    getObject: async (key: string) => {
      const o = h.objects[key];
      if (!o) throw new Error("NoSuchKey");
      return {
        Body: { transformToByteArray: async () => o.body },
        ContentType: o.contentType,
      };
    },
  }),
}));

import { inlineFileRefs } from "./inline-files";

describe("inlineFileRefs（沙箱渲染的图片内联）", () => {
  it("无 /files 引用时原样返回", async () => {
    const html = '<html><body><h1>x</h1></body></html>';
    expect(await inlineFileRefs(html)).toBe(html);
  });

  it("files 引用替换为 data URI（含 ContentType）", async () => {
    h.objects["assets/x.png"] = { body: [137, 80, 78, 71], contentType: "image/png" };
    const html = '<img src="/files/assets/x.png">';
    const out = await inlineFileRefs(html);
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain("/files/assets/x.png");
  });

  it("同一 key 多处引用只读一次存储", async () => {
    h.objects["assets/y.jpg"] = { body: [1, 2, 3], contentType: "image/jpeg" };
    const html = '<img src="/files/assets/y.jpg"><div style="background:url(/files/assets/y.jpg)"></div>';
    const out = await inlineFileRefs(html);
    expect(out.match(/data:image\/jpeg;base64,/g)).toHaveLength(2);
  });

  it("读取失败的引用保持原样（渲染时拦截不致命）", async () => {
    const html = '<img src="/files/assets/missing.png"><img src="/files/assets/x.png">';
    h.objects["assets/x.png"] = { body: [1], contentType: "image/png" };
    const out = await inlineFileRefs(html);
    expect(out).toContain("/files/assets/missing.png");
    expect(out).toContain("data:image/png;base64,");
  });
});
