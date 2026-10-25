/**
 * 子集字体加载单测。
 *
 * 这里 mock 掉 node:fs 的 readFileSync，因为 FONT_DIR 由 process.cwd() 推导、
 * 不可注入——要验证「字体缺失时明确抛错」只能从读取失败这一侧构造。
 * 注意 mock 是文件级的，故本文件只测 fonts.ts，不碰渲染流水线。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn() };
});

import { readFileSync } from "node:fs";
import {
  loadPosterFont,
  posterSatoriFonts,
  resetPosterFontCache,
} from "./fonts";

const mockedRead = vi.mocked(readFileSync);

/** 构造一个假 buffer（内容不重要，只看读取与缓存行为）。 */
function fakeBuffer(size = 4096) {
  return Buffer.alloc(size, 0);
}

beforeEach(() => {
  resetPosterFontCache();
  mockedRead.mockReset();
});

afterEach(() => {
  resetPosterFontCache();
});

describe("loadPosterFont", () => {
  it("读取成功时返回 buffer 并缓存（同一字重只读一次盘）", () => {
    mockedRead.mockReturnValue(fakeBuffer());
    const a = loadPosterFont("regular");
    const b = loadPosterFont("regular");
    expect(a).toBe(b);
    expect(mockedRead).toHaveBeenCalledTimes(1);
    // 两个不同字重应分别读取
    loadPosterFont("bold");
    expect(mockedRead).toHaveBeenCalledTimes(2);
  });

  it("字体缺失时抛错且信息可操作（不得静默降级）", () => {
    mockedRead.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(() => loadPosterFont("regular")).toThrowError(/子集字体缺失/);
    // 错误信息必须指向修复手段，否则部署时缺字体只能看到一句裸 ENOENT
    expect(() => loadPosterFont("regular")).toThrowError(/build-subset-font\.mjs/);
  });

  it("失败不写缓存：修复字体后下次调用能成功", () => {
    mockedRead.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadPosterFont("regular")).toThrow();
    mockedRead.mockReturnValueOnce(fakeBuffer());
    const recovered = loadPosterFont("regular");
    expect(recovered.byteLength).toBeGreaterThan(0);
  });
});

describe("posterSatoriFonts", () => {
  it("提供两个字重，且 CSS 字重值与契约一致", () => {
    mockedRead.mockImplementation(() => fakeBuffer());
    const fonts = posterSatoriFonts();
    expect(fonts).toHaveLength(2);
    expect(fonts.map((f) => f.weight).sort()).toEqual([400, 700]);
    // satori 按 font-family 名匹配两个字重条目，名字必须相同
    expect(new Set(fonts.map((f) => f.name)).size).toBe(1);
    for (const f of fonts) expect(f.style).toBe("normal");
  });

  it("任一字重缺失即抛错（不会只注入一个就继续）", () => {
    mockedRead.mockImplementationOnce(() => fakeBuffer()); // regular 成功
    mockedRead.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    }); // bold 缺失
    expect(() => posterSatoriFonts()).toThrowError(/子集字体缺失/);
  });
});
