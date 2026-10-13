import { describe, expect, it } from "vitest";
import { buildAssetResponse } from "./serve";
import type { Storage } from "./s3";

function fakeStorage(object?: unknown, throws?: { name: string }): Storage {
  return {
    async putObject() {
      return "";
    },
    async getObject() {
      if (throws) throw throws;
      return object as Awaited<ReturnType<Storage["getObject"]>>;
    },
    async removeObject() {},
  };
}

describe("buildAssetResponse", () => {
  it("serves an inline image with correct headers", async () => {
    const storage = fakeStorage({
      Body: new Uint8Array([1, 2, 3]),
      ContentType: "image/png",
      ContentLength: 3,
    });
    const res = await buildAssetResponse("assets/x.png", storage);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(3);
  });

  it("forces SVG to attachment to prevent inline XSS", async () => {
    const storage = fakeStorage({
      Body: new Uint8Array([60, 115, 118, 103]),
      ContentType: "image/svg+xml",
    });
    const res = await buildAssetResponse("assets/x.svg", storage);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("forces HTML to attachment", async () => {
    const storage = fakeStorage({
      Body: new Uint8Array([60, 104, 116, 109, 108]),
      ContentType: "text/html",
    });
    const res = await buildAssetResponse("assets/x.html", storage);
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("returns 404 for a missing object", async () => {
    const storage = fakeStorage(undefined, { name: "NoSuchKey" });
    const res = await buildAssetResponse("assets/missing.png", storage);
    expect(res.status).toBe(404);
  });

  it("returns 403 for keys outside assets/", async () => {
    const storage = fakeStorage({ Body: new Uint8Array(), ContentType: "image/png" });
    const res = await buildAssetResponse("../secret", storage);
    expect(res.status).toBe(403);
  });
});
