import { describe, expect, it } from "vitest";
import { OWNER_ID, parseEnv } from "./config";

const validEnv = {
  DATABASE_URL: "postgresql://oops:oops@localhost:5432/oops",
  MINIO_ENDPOINT: "localhost",
  MINIO_ACCESS_KEY: "minioadmin",
  MINIO_SECRET_KEY: "minioadmin",
  MINIO_BUCKET: "oops-assets",
};

describe("parseEnv", () => {
  it("parses a full valid env with defaults applied", () => {
    const config = parseEnv(validEnv);
    expect(config.MINIO_PORT).toBe(9000);
    expect(config.MINIO_USE_SSL).toBe(false);
    expect(config.OWNER_ID).toBe("owner");
    expect(config.QWEN_TOKEN_PLAN_CN_API_KEY).toBeUndefined();
  });

  it("coerces MINIO_PORT and transforms MINIO_USE_SSL", () => {
    const config = parseEnv({
      ...validEnv,
      MINIO_PORT: "9443",
      MINIO_USE_SSL: "true",
    });
    expect(config.MINIO_PORT).toBe(9443);
    expect(config.MINIO_USE_SSL).toBe(true);
  });

  it("throws when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omit, ...env } = validEnv;
    expect(() => parseEnv(env)).toThrowError(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() =>
      parseEnv({ ...validEnv, DATABASE_URL: "mysql://x" }),
    ).toThrowError(/postgresql/);
  });

  it("throws on non-numeric MINIO_PORT", () => {
    expect(() => parseEnv({ ...validEnv, MINIO_PORT: "abc" })).toThrowError();
  });

  it("throws when a MINIO credential is missing", () => {
    const { MINIO_SECRET_KEY: _omit, ...env } = validEnv;
    expect(() => parseEnv(env)).toThrowError(/MINIO_SECRET_KEY/);
  });
});

describe("OWNER_ID", () => {
  it("falls back to 'owner' when env is unset", () => {
    expect(OWNER_ID).toBe("owner");
  });
});
