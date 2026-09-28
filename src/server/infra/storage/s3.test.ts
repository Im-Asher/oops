import { describe, expect, it, vi } from "vitest";
import { createStorage, extFromMime, generateAssetKey } from "./s3";

describe("generateAssetKey / extFromMime", () => {
  it("generates assets/<uuid>.<ext>", () => {
    const key = generateAssetKey("PNG");
    expect(key).toMatch(/^assets\/[0-9a-f-]+\.png$/);
  });

  it("maps mime to extension", () => {
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/svg+xml")).toBe("svg");
    expect(extFromMime("application/json")).toBe("json");
    expect(extFromMime("weird/type")).toBe("bin");
  });
});

describe("storage", () => {
  it("putObject sends PutObjectCommand with bucket/key/contentType", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createStorage({ send });
    const key = await storage.putObject("assets/x.png", Buffer.from("hi"), "image/png");

    expect(key).toBe("assets/x.png");
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0] as {
      input: { Bucket: string; Key: string; ContentType: string };
    };
    expect(cmd.input.Bucket).toBe("oops-assets");
    expect(cmd.input.Key).toBe("assets/x.png");
    expect(cmd.input.ContentType).toBe("image/png");
  });

  it("getObject sends GetObjectCommand for the key", async () => {
    const send = vi.fn().mockResolvedValue({ Body: Buffer.from("data") });
    const storage = createStorage({ send });
    const res = await storage.getObject("assets/x.png");
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as { input: { Key: string } }).input.Key).toBe(
      "assets/x.png",
    );
    expect(res.Body).toBeDefined();
  });
});
