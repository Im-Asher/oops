import { describe, expect, it } from "vitest";
import { apiErrorMessage, type ApiErrorKey } from "./api-error";

// 回显式伪 t：断言按 code 命中的词典 key
const echoT = (key: ApiErrorKey) => `[${key}]`;

describe("apiErrorMessage", () => {
  it("code 已登记 → 词典文案（而非 server message）", () => {
    expect(
      apiErrorMessage(
        { code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" },
        echoT,
        "fallback",
      ),
    ).toBe("[invalidCredentials]");
  });

  it("UNAUTHORIZED 与 UNAUTHENTICATED 同映射", () => {
    expect(apiErrorMessage({ code: "UNAUTHORIZED" }, echoT, "fb")).toBe("[unauthenticated]");
    expect(apiErrorMessage({ code: "UNAUTHENTICATED" }, echoT, "fb")).toBe("[unauthenticated]");
  });

  it("上传错误 code 已登记（通用文案，不带服务端插值）", () => {
    expect(apiErrorMessage({ code: "TOO_LARGE", message: "文件过大，上限 10485760 字节" }, echoT, "fb")).toBe(
      "[tooLarge]",
    );
    expect(apiErrorMessage({ code: "UNSUPPORTED_TYPE", message: "不支持的文件类型：image/gif" }, echoT, "fb")).toBe(
      "[unsupportedType]",
    );
  });

  it("未登记 code（动态校验/审核原文等）→ server message 兜底", () => {
    expect(apiErrorMessage({ code: "INVALID_INPUT", message: "密码至少 8 位" }, echoT, "fb")).toBe(
      "密码至少 8 位",
    );
    expect(apiErrorMessage({ code: "BLOCKED", message: "含敏感内容" }, echoT, "fb")).toBe(
      "含敏感内容",
    );
  });

  it("无 code（如 zod 动态消息）→ server message", () => {
    expect(apiErrorMessage({ message: "密码至少 8 位" }, echoT, "fb")).toBe("密码至少 8 位");
  });

  it("空错误体或无 message → fallback", () => {
    expect(apiErrorMessage(null, echoT, "fb")).toBe("fb");
    expect(apiErrorMessage(undefined, echoT, "fb")).toBe("fb");
    expect(apiErrorMessage({}, echoT, "fb")).toBe("fb");
    expect(apiErrorMessage({ code: "" , message: "m" }, echoT, "fb")).toBe("m");
    expect(apiErrorMessage({ code: "UNRECOGNIZED_CODE" }, echoT, "fb")).toBe("fb");
  });
});
