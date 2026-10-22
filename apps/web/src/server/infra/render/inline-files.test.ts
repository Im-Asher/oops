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
      // noBody 标记：模拟对象存在但读不到字节（Body 为 undefined）
      if ((o as { noBody?: boolean }).noBody) {
        return { Body: undefined, ContentType: o.contentType };
      }
      return {
        Body: { transformToByteArray: async () => o.body },
        ContentType: o.contentType,
      };
    },
  }),
}));

import { inlineFileRefs } from "./inline-files";

describe("inlineFileRefs（沙箱渲染的图片内联）", () => {
  it("无 /files 引用时原样返回且不计数", async () => {
    const html = '<html><body><h1>x</h1></body></html>';
    const { html: out, dropped } = await inlineFileRefs(html);
    expect(out).toBe(html);
    expect(dropped).toBe(0);
  });

  it("files 引用替换为 data URI（含 ContentType）", async () => {
    h.objects["assets/x.png"] = { body: [137, 80, 78, 71], contentType: "image/png" };
    const html = '<img src="/files/assets/x.png">';
    const { html: out, dropped } = await inlineFileRefs(html);
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain("/files/assets/x.png");
    expect(dropped).toBe(0);
  });

  it("同一 key 多处引用只读一次存储", async () => {
    h.objects["assets/y.jpg"] = { body: [1, 2, 3], contentType: "image/jpeg" };
    const html = '<img src="/files/assets/y.jpg"><div style="background:url(/files/assets/y.jpg)"></div>';
    const { html: out } = await inlineFileRefs(html);
    expect(out.match(/data:image\/jpeg;base64,/g)).toHaveLength(2);
  });

  it("读取失败的引用被剥离（无浏览器下残留相对路径只会得到空图）", async () => {
    const html = '<img src="/files/assets/missing.png"><img src="/files/assets/x.png">';
    h.objects["assets/x.png"] = { body: [1], contentType: "image/png" };
    const { html: out, dropped } = await inlineFileRefs(html);
    // 失败的引用被剥离，不影响同一 HTML 里其它引用正常内联
    expect(out).not.toContain("/files/assets/missing.png");
    expect(out).toContain('src="data:image/png;base64,');
    expect(dropped).toBe(1);
  });

  it("读取失败时移除整个 img 标签，不留下 src=\"\"（否则渲染器整次失败）", async () => {
    // 回归：旧实现只抹掉 URL 字符串，留下 <img src="">，satori 抛
    // "Image source is not provided" 让整次渲染失败，且错误被误报成「版式非法」。
    const html =
      '<div><img src="/files/assets/gone.png" style="width:300px"><img src="/files/assets/x.png"></div>';
    h.objects["assets/x.png"] = { body: [1], contentType: "image/png" };
    const { html: out, dropped } = await inlineFileRefs(html);
    // 失败的那个 img 整标签消失，不留下 src=""
    expect(out).not.toContain("/files/assets/gone.png");
    expect(out).not.toContain('src=""');
    // 正常的引用仍应内联成功（同一 HTML 里只余这一个 img）
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).toContain('src="data:image/png;base64,');
    expect(dropped).toBe(1);
  });

  it("读取失败时 CSS url() 引用替换为 none（不留空 url）", async () => {
    const html = '<div style="background-image:url(/files/assets/gone.png)"></div>';
    const { html: out, dropped } = await inlineFileRefs(html);
    expect(out).toContain("background-image:none");
    expect(out).not.toContain("/files/assets/gone.png");
    expect(out).not.toContain("url()");
    expect(dropped).toBe(1);
  });

  it("同一失败 key 的多处引用按处计数", async () => {
    const html =
      '<img src="/files/assets/gone.png"><img src="/files/assets/gone.png"><div style="background:url(\'/files/assets/gone.png\')"></div>';
    const { html: out, dropped } = await inlineFileRefs(html);
    expect(out).toBe('<div style="background:none"></div>');
    expect(dropped).toBe(3);
  });

  it("Body 缺失（无字节可读）时同样移除整个 img 标签", async () => {
    // Body 为 undefined：与读取失败同属「拿不到字节」，必须降级为移除而非留下坏 src
    h.objects["assets/nobody.png"] = { noBody: true } as unknown as {
      body: number[];
      contentType?: string;
    };
    const { html: out, dropped } = await inlineFileRefs('<img src="/files/assets/nobody.png">');
    expect(out).toBe("");
    expect(dropped).toBe(1);
  });
});
