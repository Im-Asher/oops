import { describe, expect, it } from "vitest";
import {
  getAdminAuthConfig,
  getAuthConfig,
  getDbConfig,
  getImageConfig,
  getLlmConfig,
  getRenderConfig,
  getS3Config,
  parseEnv,
} from "./index";

const S3_VALID = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_BUCKET: "oops",
};

const FULL_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/oops",
  AUTH_SECRET: "x".repeat(32),
  ...S3_VALID,
  QWEN_TOKEN_PLAN_CN_API_KEY: "sk-test",
  LLM_MAIN_MODEL: "qwen3-max",
  IMAGE_ENDPOINT: "https://example.com/img",
  RENDER_EXECUTABLE_PATH: "/usr/bin/chromium",
};

describe("parseEnv 全量解析", () => {
  it("合法 env 解析出全量配置（含各域默认值）", () => {
    const c = parseEnv(FULL_ENV);
    expect(c.DATABASE_URL).toBe("postgresql://localhost:5432/oops");
    expect(c.S3_FORCE_PATH_STYLE).toBe(true);
    expect(c.LLM_PROVIDER).toBe("qwen-token-plan-cn");
    expect(c.IMAGE_MODELS).toEqual(["wan2.7-image"]);
    expect(c.RENDER_ALLOWED_HOSTS).toEqual([]);
    expect(c.RENDER_TIMEOUT_MS).toBe(30000);
  });

  it("非法 env 抛出 ZodError（含 key 名定位）", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("getDbConfig", () => {
  it("合法连接串映射 databaseUrl", () => {
    expect(getDbConfig({ DATABASE_URL: "postgresql://localhost/oops" })).toEqual({
      databaseUrl: "postgresql://localhost/oops",
    });
  });

  it("缺失抛错", () => {
    expect(() => getDbConfig({})).toThrow(/DATABASE_URL/);
  });

  it("非 postgres 协议抛错", () => {
    expect(() => getDbConfig({ DATABASE_URL: "mysql://localhost/oops" })).toThrow(
      /postgresql/,
    );
  });
});

describe("getAuthConfig", () => {
  it("合法密钥映射 authSecret", () => {
    expect(getAuthConfig({ AUTH_SECRET: "x".repeat(32) })).toEqual({
      authSecret: "x".repeat(32),
    });
  });

  it("过短抛错", () => {
    expect(() => getAuthConfig({ AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });
});

describe("getAdminAuthConfig", () => {
  const AUTH = { AUTH_SECRET: "x".repeat(32) };

  it("未配 ADMIN_AUTH_SECRET 时回退 AUTH_SECRET，并给出默认有效期与路径", () => {
    expect(getAdminAuthConfig(AUTH)).toEqual({
      adminAuthSecret: "x".repeat(32),
      adminSessionMaxAgeSeconds: 43200,
      adminCookiePath: "/",
    });
  });

  it("显式配置覆盖全部三项", () => {
    expect(
      getAdminAuthConfig({
        ...AUTH,
        ADMIN_AUTH_SECRET: "y".repeat(32),
        ADMIN_SESSION_MAX_AGE_SECONDS: "3600",
        ADMIN_COOKIE_PATH: "/admin",
      }),
    ).toEqual({
      adminAuthSecret: "y".repeat(32),
      adminSessionMaxAgeSeconds: 3600,
      adminCookiePath: "/admin",
    });
  });

  it("ADMIN_AUTH_SECRET 过短抛错", () => {
    expect(() => getAdminAuthConfig({ ...AUTH, ADMIN_AUTH_SECRET: "short" })).toThrow(
      /ADMIN_AUTH_SECRET/,
    );
  });

  it("ADMIN_SESSION_MAX_AGE_SECONDS 非正整数抛错", () => {
    expect(() =>
      getAdminAuthConfig({ ...AUTH, ADMIN_SESSION_MAX_AGE_SECONDS: "0" }),
    ).toThrow();
  });
});

describe("getS3Config", () => {
  it("全量映射 camelCase（显式 false 生效）", () => {
    const c = getS3Config({ ...S3_VALID, S3_FORCE_PATH_STYLE: "false" });
    expect(c).toEqual({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "oops",
      forcePathStyle: false,
    });
  });

  it("forcePathStyle 默认 true（MinIO path-style）", () => {
    expect(getS3Config({ ...S3_VALID }).forcePathStyle).toBe(true);
  });

  it("缺 endpoint 抛错（域级 key 名）", () => {
    const { S3_ENDPOINT: _omit, ...rest } = S3_VALID;
    expect(() => getS3Config(rest)).toThrow(/S3_ENDPOINT/);
  });
});

describe("getLlmConfig", () => {
  it("默认 provider，可选字段透传", () => {
    const c = getLlmConfig({ QWEN_TOKEN_PLAN_CN_API_KEY: "sk", LLM_MAIN_MODEL: "m1" });
    expect(c.provider).toBe("qwen-token-plan-cn");
    expect(c.mainModel).toBe("m1");
    expect(c.summarizerModel).toBeUndefined();
    expect(c.qwenApiKey).toBe("sk");
  });
});

describe("getImageConfig", () => {
  it("models 逗号拆分并 trim 空项", () => {
    expect(getImageConfig({ IMAGE_MODELS: " a , b,,c " }).models).toEqual(["a", "b", "c"]);
  });

  it("endpoint 默认值指向 Token Plan", () => {
    expect(getImageConfig({}).endpoint).toContain("maas.aliyuncs.com");
  });
});

describe("getRenderConfig", () => {
  it("allowedHosts 拆分 / timeout 字符串 coerce 为数字", () => {
    const c = getRenderConfig({
      RENDER_ALLOWED_HOSTS: "a.com, b.cn",
      RENDER_TIMEOUT_MS: "5000",
    });
    expect(c.allowedHosts).toEqual(["a.com", "b.cn"]);
    expect(c.timeoutMs).toBe(5000);
  });

  it("executablePath 可选缺省", () => {
    expect(getRenderConfig({}).executablePath).toBeUndefined();
  });
});
