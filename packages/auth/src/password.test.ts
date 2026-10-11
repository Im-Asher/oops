import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("roundtrips a correct password", async () => {
    const stored = await hashPassword("s3cret-password");
    await expect(verifyPassword("s3cret-password", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("s3cret-password");
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });

  it("salts randomly so identical passwords hash differently", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("rejects malformed stored values without throwing", async () => {
    await expect(verifyPassword("x", "bcrypt$abc$def")).resolves.toBe(false);
    await expect(verifyPassword("x", "garbage")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });
});
