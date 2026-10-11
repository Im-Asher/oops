import { describe, expect, it } from "vitest";
import { resolveDisplayName } from "./nickname";

describe("resolveDisplayName", () => {
  it("returns displayName when set", () => {
    expect(resolveDisplayName({ displayName: "阿明", oopsId: "stnbkp88" })).toBe("阿明");
  });

  it("falls back to bare oopsId when displayName is null", () => {
    expect(resolveDisplayName({ displayName: null, oopsId: "stnbkp88" })).toBe("stnbkp88");
  });

  it("falls back to bare oopsId when displayName is empty string", () => {
    expect(resolveDisplayName({ displayName: "", oopsId: "stnbkp88" })).toBe("stnbkp88");
  });
});
