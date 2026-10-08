// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDoc } from "@/lib/design/doc";
import { clearDraft, loadDraft, saveDraft } from "./draft-storage";

beforeEach(() => {
  window.localStorage.clear();
});

describe("设计草稿存取", () => {
  it("保存后读取往返一致", () => {
    const doc = createEmptyDoc(1242, 2208);
    saveDraft(doc);
    expect(loadDraft()).toEqual(doc);
  });

  it("损坏 JSON 与版本不符 → null（回落空白）", () => {
    window.localStorage.setItem("oops:design:draft:v1", "{not json");
    expect(loadDraft()).toBeNull();
    window.localStorage.setItem(
      "oops:design:draft:v1",
      JSON.stringify({ ...createEmptyDoc(100, 100), version: 99 }),
    );
    expect(loadDraft()).toBeNull();
  });

  it("无草稿与显式清除 → null", () => {
    expect(loadDraft()).toBeNull();
    saveDraft(createEmptyDoc(100, 100));
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it("注入存储失效与 SSR 空存储：静默不抛", () => {
    const throwing = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
      removeItem: () => {
        throw new Error("boom");
      },
    };
    expect(loadDraft(throwing)).toBeNull();
    expect(() => saveDraft(createEmptyDoc(1, 1), throwing)).not.toThrow();
    expect(() => clearDraft(throwing)).not.toThrow();
    expect(loadDraft(null)).toBeNull();
    expect(() => saveDraft(createEmptyDoc(1, 1), null)).not.toThrow();
  });
});
