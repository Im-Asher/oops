import { describe, expect, it, vi } from "vitest";
import {
  generateOopsId,
  generateUniqueOopsId,
  OOPS_ID_PATTERN,
  OopsIdGenerationError,
} from "./oops-id";

describe("generateOopsId", () => {
  it("generates 8-char ids from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateOopsId();
      expect(id).toMatch(OOPS_ID_PATTERN);
      expect(id).not.toMatch(/[01ilo]/);
    }
  });

  it("generates distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, generateOopsId));
    expect(ids.size).toBeGreaterThan(95);
  });
});

describe("generateUniqueOopsId", () => {
  it("returns the first available id", async () => {
    const isAvailable = vi.fn().mockResolvedValue(true);
    await expect(generateUniqueOopsId(isAvailable)).resolves.toMatch(
      OOPS_ID_PATTERN,
    );
    expect(isAvailable).toHaveBeenCalledOnce();
  });

  it("retries when the id is taken and succeeds within the limit", async () => {
    let calls = 0;
    const isAvailable = vi.fn(async () => ++calls >= 3);
    await expect(generateUniqueOopsId(isAvailable)).resolves.toMatch(
      OOPS_ID_PATTERN,
    );
    expect(calls).toBe(3);
  });

  it("throws after 5 exhausted attempts", async () => {
    const isAvailable = vi.fn().mockResolvedValue(false);
    await expect(generateUniqueOopsId(isAvailable)).rejects.toBeInstanceOf(
      OopsIdGenerationError,
    );
    expect(isAvailable).toHaveBeenCalledTimes(5);
  });
});
