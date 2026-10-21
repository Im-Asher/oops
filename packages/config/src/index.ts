import { z } from "zod";

/**
 * 环境配置单一入口（@oops/config）。
 * - schema 按域分组（core/auth/s3/llm/image/render），消费方只 import 自己域的
 *   getter：缺失 key 在该子系统首用时即抛 ZodError（错误信息含 env key 名直接定位）。
 * - parseEnv() 保留为全量解析入口（诊断/测试用）；域 getter 均支持注入 env（仅测试）。
 * - 所有密钥/连接串只能经本模块读取，禁止散落的 process.env
 *   （asset-storage spec：后端专属参数只经 env 配置、代码零硬编码）。
 */

// —— 域 schema 形状（域间共享 key 复用同一 zod 实例，全量组合无冲突） ——

/** DB 连接域。 */
const coreShape = {
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 缺失")
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "DATABASE_URL 必须是 postgresql 连接串",
    ),
};

/** 会话域：cookie 签名密钥。 */
const authShape = {
  // 长度下限保证离线暴力破解不可行
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET 需至少 32 字符（生成：openssl rand -base64 32）"),
};

/** 跨端引导域（WEB_APP_URL）：admin 登出等跳转 web 的基地址。 */
const webShape = {
  WEB_APP_URL: z.string().url("WEB_APP_URL 必须是完整 URL").optional(),
};

/**
 * 管理端会话域（add-admin-login design D2/D3/D8）：
 * 会话 cookie 与 web 端不同名且密钥独立；未配 ADMIN_AUTH_SECRET 时回退 AUTH_SECRET，
 * 保证单实例开发环境开箱可用，生产单独配置即可隔离两侧失陷面。
 */
const adminAuthShape = {
  ADMIN_AUTH_SECRET: z
    .string()
    .min(32, "ADMIN_AUTH_SECRET 需至少 32 字符（生成：openssl rand -base64 32）")
    .optional(),
  // 管理端是高权限面：默认远短于 web 端 30 天，且不滑动
  ADMIN_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(43200),
  // 同域子路径部署（如 /admin）时限定 cookie Path，避免管理端会话被发往 web 路由
  ADMIN_COOKIE_PATH: z.string().min(1).default("/"),
};

/** S3 兼容对象存储域（全部后端专属，缺失即存储子系统不可用）。 */
const s3Shape = {
  S3_ENDPOINT: z.string().url("S3_ENDPOINT 必须是完整 URL"),
  S3_REGION: z.string().min(1, "S3_REGION 缺失"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY 缺失"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY 缺失"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET 缺失"),
  // MinIO 等自建端点需要 path-style 寻址，默认开启
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
};

/** Token Plan China API key：DashScope 图像生成与 LLM 共用。 */
const qwenApiKey = z.string().min(1).optional();

/** LLM 装配域（llm-assembly spec：供应商显式声明 + 角色级模型覆盖）。 */
const llmShape = {
  QWEN_TOKEN_PLAN_CN_API_KEY: qwenApiKey,
  LLM_PROVIDER: z.string().min(1).default("qwen-token-plan-cn"),
  LLM_MAIN_MODEL: z.string().min(1).optional(),
  LLM_SUMMARIZER_MODEL: z.string().min(1).optional(),
};

/** 图像生成域（DashScope Token Plan）。 */
const imageShape = {
  QWEN_TOKEN_PLAN_CN_API_KEY: qwenApiKey,
  IMAGE_MODELS: z
    .string()
    .default("wan2.7-image")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  IMAGE_DEFAULT_SIZE: z.string().default("1024*1024"),
  IMAGE_ENDPOINT: z
    .string()
    .default(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    ),
};

/** 海报渲染域（poster-rendering spec）。无浏览器渲染，无 Chromium 可执行路径。 */
const renderShape = {
  // 图片外链白名单 host（逗号分隔；空 = 仅内联 data: 放行，其余外链在渲染前剥离）
  RENDER_ALLOWED_HOSTS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  // 单次渲染超时 ms。实测渲染约 23ms，上限主要留给图片内联的对象存储读取
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
};

const coreSchema = z.object(coreShape);
const authSchema = z.object(authShape);
const adminAuthSchema = z.object(adminAuthShape);
const webSchema = z.object(webShape);
const s3Schema = z.object(s3Shape);
const llmSchema = z.object(llmShape);
const imageSchema = z.object(imageShape);
const renderSchema = z.object(renderShape);

const envSchema = z.object({
  ...coreShape,
  ...authShape,
  ...adminAuthShape,
  ...webShape,
  ...s3Shape,
  ...llmShape,
  ...imageShape,
  ...renderShape,
});

export type AppConfig = z.infer<typeof envSchema>;

type Env = Record<string, string | undefined>;

/** 全量解析并校验环境变量（非法时抛 ZodError，错误信息含 env key 名）。 */
export function parseEnv(env: Env = process.env): AppConfig {
  return envSchema.parse(env);
}

// —— 域配置接口与 getter（camelCase 语义字段） ——

export interface DbConfig {
  databaseUrl: string;
}

/** DB 连接域（DATABASE_URL）。 */
export function getDbConfig(env: Env = process.env): DbConfig {
  const v = coreSchema.parse(env);
  return { databaseUrl: v.DATABASE_URL };
}

export interface AuthConfig {
  authSecret: string;
}

/** 会话签名域（AUTH_SECRET）。 */
export function getAuthConfig(env: Env = process.env): AuthConfig {
  const v = authSchema.parse(env);
  return { authSecret: v.AUTH_SECRET };
}

export interface AdminAuthConfig {
  /** 管理端会话签名密钥；未单独配置时回退 AUTH_SECRET */
  adminAuthSecret: string;
  /** 管理端会话有效期（秒），默认 12 小时 */
  adminSessionMaxAgeSeconds: number;
  /** 管理端会话 cookie 的 Path，默认 / */
  adminCookiePath: string;
}

/**
 * 管理端会话域（ADMIN_AUTH_SECRET / ADMIN_SESSION_MAX_AGE_SECONDS / ADMIN_COOKIE_PATH）。
 * 密钥回退到 AUTH_SECRET 是刻意的：开发环境无需多配一个变量即可启动管理端。
 */
export function getAdminAuthConfig(env: Env = process.env): AdminAuthConfig {
  const v = adminAuthSchema.parse(env);
  return {
    adminAuthSecret: v.ADMIN_AUTH_SECRET ?? getAuthConfig(env).authSecret,
    adminSessionMaxAgeSeconds: v.ADMIN_SESSION_MAX_AGE_SECONDS,
    adminCookiePath: v.ADMIN_COOKIE_PATH,
  };
}

export interface WebAppConfig {
  webAppUrl: string;
}

/** 跨端引导域（WEB_APP_URL）；缺省 dev 默认 localhost:3000。 */
export function getWebAppConfig(env: Env = process.env): WebAppConfig {
  const v = webSchema.parse(env);
  return { webAppUrl: v.WEB_APP_URL ?? "http://localhost:3000" };
}

export interface S3Config {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

/** S3 存储域（S3_*）。 */
export function getS3Config(env: Env = process.env): S3Config {
  const v = s3Schema.parse(env);
  return {
    endpoint: v.S3_ENDPOINT,
    region: v.S3_REGION,
    accessKey: v.S3_ACCESS_KEY,
    secretKey: v.S3_SECRET_KEY,
    bucket: v.S3_BUCKET,
    forcePathStyle: v.S3_FORCE_PATH_STYLE,
  };
}

export interface LlmConfig {
  provider: string;
  mainModel?: string;
  summarizerModel?: string;
  qwenApiKey?: string;
}

/** LLM 装配域（LLM_* + DashScope 共用 key）。 */
export function getLlmConfig(env: Env = process.env): LlmConfig {
  const v = llmSchema.parse(env);
  return {
    provider: v.LLM_PROVIDER,
    mainModel: v.LLM_MAIN_MODEL,
    summarizerModel: v.LLM_SUMMARIZER_MODEL,
    qwenApiKey: v.QWEN_TOKEN_PLAN_CN_API_KEY,
  };
}

export interface ImageConfig {
  models: string[];
  defaultSize: string;
  endpoint: string;
  qwenApiKey?: string;
}

/** 图像生成域（IMAGE_* + DashScope 共用 key）。 */
export function getImageConfig(env: Env = process.env): ImageConfig {
  const v = imageSchema.parse(env);
  return {
    models: v.IMAGE_MODELS,
    defaultSize: v.IMAGE_DEFAULT_SIZE,
    endpoint: v.IMAGE_ENDPOINT,
    qwenApiKey: v.QWEN_TOKEN_PLAN_CN_API_KEY,
  };
}

export interface RenderConfig {
  /** 图片外链白名单 host（空 = 仅内联 data: 放行）。 */
  allowedHosts: string[];
  timeoutMs: number;
}

/** 海报渲染域（RENDER_*）：图片外链白名单 + 单次渲染超时。 */
export function getRenderConfig(env: Env = process.env): RenderConfig {
  const v = renderSchema.parse(env);
  return {
    allowedHosts: v.RENDER_ALLOWED_HOSTS,
    timeoutMs: v.RENDER_TIMEOUT_MS,
  };
}
