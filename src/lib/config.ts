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
});

export type AppConfig = z.infer<typeof envSchema>;

/** 解析并校验环境变量；非法时抛出 ZodError（缺 key 早报错）。单独导出以便测试。 */
export function parseEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
