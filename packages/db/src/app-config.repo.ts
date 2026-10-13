import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb } from ".";
import { appConfig } from "./schema";
import type { DbClient } from "./credit-ledger.repo";

/**
 * 类型化键空间（design D2）。三命名空间：
 * - `agent.<agentId>.enabled`              value = boolean
 * - `model.<providerId>.<modelId>.enabled` value = boolean
 * - `model.roleDefaults.<role>`            value = { providerId, modelId }
 *
 * repo 只保证键形状与 value 形状（zod）；id 存在性（agent registry /
 * llm catalog）属依赖方语义，db 禁止反向依赖，由 admin route 写入前校验。
 */
const AGENT_KEY_RE = /^agent\.[a-z0-9][a-z0-9-]*\.enabled$/;
const MODEL_KEY_RE = /^model\.[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*\.enabled$/;
const ROLE_DEFAULT_KEY_RE = /^model\.roleDefaults\.(main|summarizer)$/;

const boolValueSchema = z.boolean();
const roleDefaultValueSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

/** 校验 key/value 形状匹配，不符抛错（写入入口单点把关）。 */
export function assertConfigKeyValue(key: string, value: unknown): void {
  if (ROLE_DEFAULT_KEY_RE.test(key)) {
    const parsed = roleDefaultValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `app_config 非法值（${key} 须为 { providerId, modelId }）：${parsed.error.message}`,
      );
    }
    return;
  }
  if (AGENT_KEY_RE.test(key) || MODEL_KEY_RE.test(key)) {
    if (!boolValueSchema.safeParse(value).success) {
      throw new Error(`app_config 非法值（${key} 须为 boolean）`);
    }
    return;
  }
  throw new Error(`app_config 非法键：${key}`);
}

export interface AppConfigRepo {
  /** 单键读取；无行返回 null。 */
  get(key: string): Promise<unknown | null>;
  /** 批量读取（overlay 协议消费方）；缺失键不出现在结果 Map。 */
  getMany(keys: readonly string[]): Promise<Map<string, unknown>>;
  /** upsert（校验失败整体拒绝，不落库）。 */
  set(input: { key: string; value: unknown; updatedBy: string }): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createAppConfigRepo(db: DbClient = defaultDb): AppConfigRepo {
  return {
    async get(key) {
      const [row] = await db
        .select({ value: appConfig.value })
        .from(appConfig)
        .where(eq(appConfig.key, key));
      return row?.value ?? null;
    },

    async getMany(keys) {
      if (keys.length === 0) return new Map();
      const rows = await db
        .select({ key: appConfig.key, value: appConfig.value })
        .from(appConfig)
        .where(inArray(appConfig.key, [...keys]));
      return new Map(rows.map((r) => [r.key, r.value]));
    },

    async set({ key, value, updatedBy }) {
      assertConfigKeyValue(key, value);
      await db
        .insert(appConfig)
        .values({ key, value, updatedBy })
        .onConflictDoUpdate({
          target: appConfig.key,
          set: { value, updatedBy, updatedAt: new Date() },
        });
    },

    async remove(key) {
      await db.delete(appConfig).where(eq(appConfig.key, key));
    },
  };
}
