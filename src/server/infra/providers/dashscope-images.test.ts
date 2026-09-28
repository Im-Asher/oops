import { describe, expect, it } from "vitest";
import { IMAGE_MODELS } from "@/lib/config";
import {
  classifyImageGenError,
  DASHSCOPE_IMAGE_MODEL,
  DASHSCOPE_IMAGE_PROVIDER,
  getImagesModels,
} from "./dashscope-images";

describe("classifyImageGenError", () => {
  it("将限流归为 rate_limited（可重试）", () => {
    const e = classifyImageGenError(429, "rate limit exceeded");
    expect(e.kind).toBe("rate_limited");
    expect(e.retryable).toBe(true);
  });

  it("将审核拦截归为 content_rejected（不可重试）", () => {
    const e = classifyImageGenError(400, "content violates sensitive policy");
    expect(e.kind).toBe("content_rejected");
    expect(e.retryable).toBe(false);
  });

  it("将超时归为 timeout（可重试）", () => {
    const e = classifyImageGenError(200, "upstream timeout");
    expect(e.kind).toBe("timeout");
  });

  it("其余归为 unknown", () => {
    const e = classifyImageGenError(500, "boom");
    expect(e.kind).toBe("unknown");
  });
});

describe("图像 provider 配置", () => {
  it("仅向白名单模型开放，未登记模型被拒绝", () => {
    expect(IMAGE_MODELS).toContain(DASHSCOPE_IMAGE_MODEL);
    const unknown = getImagesModels().getModel(DASHSCOPE_IMAGE_PROVIDER, "dall-e-3");
    expect(unknown).toBeUndefined();
  });
});
