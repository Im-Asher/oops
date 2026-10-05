import { z } from "zod";

/**
 * 全项目唯一的环境变量入口。
 * - 所有密钥/连接串只能从 getConfig() 读取，禁止散落的 process.env。
 * - QWEN_TOKEN_PLAN_CN_API_KEY 在 foundation 阶段暂为可选，
 *   chat-image-gen 上线生图时应改为必填。
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 缺失")
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "DATABASE_URL 必须是 postgresql 连接串",
    ),
  MINIO_ENDPOINT: z.string().min(1, "MINIO_ENDPOINT 缺失"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MINIO_ACCESS_KEY: z.string().min(1, "MINIO_ACCESS_KEY 缺失"),
  MINIO_SECRET_KEY: z.string().min(1, "MINIO_SECRET_KEY 缺失"),
  MINIO_BUCKET: z.string().min(1, "MINIO_BUCKET 缺失"),
  QWEN_TOKEN_PLAN_CN_API_KEY: z.string().min(1).optional(),
  OWNER_ID: z.string().min(1).default("owner"),
  // 会话 cookie 签名密钥；长度下限保证离线暴力破解不可行
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET 需至少 32 字符（生成：openssl rand -base64 32）"),
  IMAGE_MODELS: z
    .string()
    .default("wan2.7-image")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  IMAGE_DEFAULT_SIZE: z.string().default("1024*1024"),
  IMAGE_ENDPOINT: z
    .string()
    .default(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    ),
});

/** 图像生成可用模型白名单（provider 配置校验）。 */
export const IMAGE_MODELS = (process.env.IMAGE_MODELS ?? "wan2.7-image")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** 图像生成默认像素尺寸（DashScope size 格式，如 "1024*1024"）。 */
export const IMAGE_DEFAULT_SIZE = process.env.IMAGE_DEFAULT_SIZE ?? "1024*1024";
/** Token Plan 多模态生成同步接口地址。 */
export const IMAGE_ENDPOINT =
  process.env.IMAGE_ENDPOINT ??
  "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
/** Token Plan China API key，图像生成与 LLM 共用（DashScope Bearer 鉴权）。 */
export const QWEN_TOKEN_PLAN_CN_API_KEY = process.env.QWEN_TOKEN_PLAN_CN_API_KEY;

export type AppConfig = z.infer<typeof envSchema>;

/** 解析并校验环境变量；非法时抛出 ZodError（缺 key 早报错）。单独导出以便测试。 */
export function parseEnv(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return envSchema.parse(env);
}

let cached: AppConfig | undefined;

/** 惰性单例：首次访问才解析，避免构建期无 env 时崩溃。 */
export function getConfig(): AppConfig {
  cached ??= parseEnv();
  return cached;
}

/**
 * 认证延后期间的固定用户标识（多租户预留，未来替换为会话取值）。
 * 独立于 getConfig() 暴露：只需 userId 的场景不应被迫做全量 env 校验。
 */
export const OWNER_ID = process.env.OWNER_ID ?? "owner";
