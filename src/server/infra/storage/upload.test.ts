import { describe, expect, it } from "vitest";
import { handleUpload, validateUpload } from "./upload";
import type { Storage } from "./s3";
import type { AssetRepo } from "@/server/db/asset.repo";

function fakeStorage(putObject?: (...a: unknown[]) => Promise<unknown>): Storage {
  return {
    async putObject(k, b, c) {
      await putObject?.(k, b, c);
      return k;
    },
    async getObject() {
      return {} as never;
    },
  };
}

function fakeAssets() {
  const calls: unknown[] = [];
  const repo: AssetRepo = {
    async create(input) {
      calls.push(input);
      return { id: "a1", ...(input as object) } as never;
    },
    async get() {
      return undefined;
    },
    async list() {
      return [];
    },
    async remove() {},
  };
  return { repo, calls };
}

describe("validateUpload", () => {
  it("accepts whitelisted image types under the size cap", () => {
    expect(validateUpload("image/png", 1024)).toBeNull();
    expect(validateUpload("image/webp", 1)).toBeNull();
  });

  it("rejects unsupported mime types", () => {
    expect(validateUpload("text/plain", 10)?.code).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects oversized files", () => {
    expect(validateUpload("image/png", 10 * 1024 * 1024 + 1)?.code).toBe("TOO_LARGE");
  });
});

describe("handleUpload", () => {
  it("stores, records asset and returns 201 with url + assetId", async () => {
    const stored: unknown[] = [];
    const { repo, calls } = fakeAssets();
    const res = await handleUpload(
      { bytes: new Uint8Array([1, 2, 3]), type: "image/png", name: "a.png" },
      { storage: fakeStorage((...a) => Promise.resolve(stored.push(a))), assets: repo },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string; assetId: string };
    expect(body.url).toMatch(/^\/files\/assets\//);
    expect(body.assetId).toBe("a1");
    expect((calls[0] as { mimeType: string }).mimeType).toBe("image/png");
  });

  it("returns 415 for unsupported type", async () => {
    const { repo } = fakeAssets();
    const res = await handleUpload(
      { bytes: new Uint8Array([1]), type: "text/plain" },
      { storage: fakeStorage(), assets: repo },
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("returns 413 for oversized file", async () => {
    const { repo } = fakeAssets();
    const res = await handleUpload(
      { bytes: new Uint8Array(10 * 1024 * 1024 + 1), type: "image/png" },
      { storage: fakeStorage(), assets: repo },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOO_LARGE");
  });
});
