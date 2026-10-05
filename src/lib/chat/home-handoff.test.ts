import { beforeEach, describe, expect, it } from "vitest";
import {
  getPendingHandoffFiles,
  hasPendingHandoff,
  setPendingHandoffFiles,
  takePendingHandoffFiles,
} from "./home-handoff";

function file(name: string): File {
  return new File(["data"], name, { type: "image/png" });
}

beforeEach(() => {
  setPendingHandoffFiles([]);
  takePendingHandoffFiles();
});

describe("home-handoff 待传附件暂存", () => {
  it("set 后 get 返回同批文件（浅拷贝隔离外部变更）", () => {
    const files = [file("a.png"), file("b.png")];
    setPendingHandoffFiles(files);
    expect(getPendingHandoffFiles()).toEqual(files);
    expect(getPendingHandoffFiles()).not.toBe(files);
  });

  it("take 取走并清空，再次 take 为空数组", () => {
    const files = [file("a.png")];
    setPendingHandoffFiles(files);
    expect(takePendingHandoffFiles()).toEqual([files[0]]);
    expect(takePendingHandoffFiles()).toEqual([]);
    expect(getPendingHandoffFiles()).toEqual([]);
  });

  it("set 覆盖上一批（首页重复提交以最新为准）", () => {
    setPendingHandoffFiles([file("a.png")]);
    const next = [file("b.png")];
    setPendingHandoffFiles(next);
    expect(getPendingHandoffFiles()).toEqual(next);
    expect(getPendingHandoffFiles()).not.toBe(next);
  });

  it("staged 标记：set 置位、take 复位，支撑画布侧判别刷新丢附件", () => {
    expect(hasPendingHandoff()).toBe(false);
    setPendingHandoffFiles([]);
    expect(hasPendingHandoff()).toBe(true);
    takePendingHandoffFiles();
    expect(hasPendingHandoff()).toBe(false);
  });
});
