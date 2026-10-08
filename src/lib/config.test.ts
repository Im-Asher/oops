import { describe, expect, it } from "vitest";
import { OWNER_ID, parseEnv } from "./config";

const validEnv = {
  DATABASE_URL: "postgresql://oops:oops@localhost:5432/oops",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_BUCKET: "oops-assets",
  AUTH_SECRET: "unit-test-secret-0123456789abcdef-unit-test",
};

describe("parseEnv", () => {
  it("parses a full valid env with defaults applied", () => {
    const config = parseEnv(validEnv);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.OWNER_ID).toBe("owner");
    expect(config.QWEN_TOKEN_PLAN_CN_API_KEY).toBeUndefined();
  });

  it("transforms S3_FORCE_PATH_STYLE", () => {
    const config = parseEnv({
      ...validEnv,
      S3_FORCE_PATH_STYLE: "false",
    });
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
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

  it("throws when S3_ENDPOINT is not a full URL", () => {
    expect(() =>
      parseEnv({ ...validEnv, S3_ENDPOINT: "localhost" }),
    ).toThrowError(/S3_ENDPOINT/);
  });

  it("throws when an S3 credential is missing", () => {
    const { S3_SECRET_KEY: _omit, ...env } = validEnv;
    expect(() => parseEnv(env)).toThrowError(/S3_SECRET_KEY/);
  });

  it("throws when AUTH_SECRET is missing", () => {
    const { AUTH_SECRET: _omit, ...env } = validEnv;
    expect(() => parseEnv(env)).toThrowError(/AUTH_SECRET/);
  });

  it("throws when AUTH_SECRET is shorter than 32 chars", () => {
    expect(() =>
      parseEnv({ ...validEnv, AUTH_SECRET: "too-short" }),
    ).toThrowError(/AUTH_SECRET/);
  });
});

describe("OWNER_ID", () => {
  it("falls back to 'owner' when env is unset", () => {
    expect(OWNER_ID).toBe("owner");
  });
});
