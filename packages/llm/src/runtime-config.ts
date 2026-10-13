import { getLlmConfig } from "@oops/config";
import { TEXT_PROVIDERS, type LlmRole } from "./catalog";
import { ModelConfigError } from "./resolver";

/**
 * 管理面生效配置解析（design D2）：DB overlay ?? env ?? 目录，DB 有值即赢。
 * 与执行装配 resolveTextModel（fail-fast，能力 MUST NOT 静默降级）职责不同——
 * 本模块是生效值查询/展示路径，overlay 读失败 fail-open 回落下层，
 * 热读故障不放大为功能故障。
 */

export type ConfigSource = "overlay" | "env" | "catalog";

/** overlay 读取协议（依赖倒置：llm 禁止依赖 db，实现在 @oops/db app-config.repo）。 */
export interface OverlayReader {
  /** 返回命中的 key→value；缺失键可不在 Map 中（或值为 null）。 */
  readOverlay(keys: readonly string[]): Promise<Map<string, unknown>>;
}

export interface EnabledResolution {
  enabled: boolean;
  source: ConfigSource;
}

export interface RoleDefaultResolution {
  providerId: string;
  modelId: string;
  source: ConfigSource;
}

/** TTL 30s（分钟量级内取下限，跨进程写后生效窗口可控，冒烟可等待）。 */
const TTL_MS = 30_000;

interface CacheEntry {
  /** null = overlay 确认无此键（负缓存，防穿透） */
  value: unknown | null;
  expiresAt: number;
  generation: number;
}

let cache = new Map<string, CacheEntry>();
let generation = 0;

/**
 * admin 写路径主动失效本进程缓存使写后立即可见；
 * web 异进程不共享模块状态，靠 TTL 过期看到新值。
 */
export function bumpRuntimeConfigGeneration(): void {
  generation += 1;
  cache = new Map();
}

async function readOverlayCached(
  keys: readonly string[],
  reader: OverlayReader,
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  const missing: string[] = [];
  for (const key of keys) {
    const hit = cache.get(key);
    if (hit && hit.generation === generation && hit.expiresAt > Date.now()) {
      if (hit.value !== null) result.set(key, hit.value);
    } else {
      missing.push(key);
    }
  }
  if (missing.length === 0) return result;
  let fetched: Map<string, unknown>;
  try {
    fetched = await reader.readOverlay(missing);
  } catch {
    // fail-open：命中部分照用，缺失回落下层。失败不缓存——DB 恢复后立即生效
    return result;
  }
  for (const key of missing) {
    const value = fetched.get(key) ?? null;
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS, generation });
    if (value !== null) result.set(key, value);
  }
  return result;
}

function isModelRegistered(providerId: string, modelId: string): boolean {
  return TEXT_PROVIDERS.some(
    (p) => p.providerId === providerId && p.models.some((m) => m.id === modelId),
  );
}

function isRoleDefaultOverlay(value: unknown): value is { providerId: string; modelId: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { providerId?: unknown }).providerId === "string" &&
    typeof (value as { modelId?: unknown }).modelId === "string"
  );
}

/** Agent 启停：overlay bool 即赢，缺省/脏值回落目录默认（放行）。 */
export async function resolveAgentEnabled(
  agentId: string,
  reader: OverlayReader,
): Promise<EnabledResolution> {
  const key = `agent.${agentId}.enabled`;
  const overlay = await readOverlayCached([key], reader);
  const value = overlay.get(key);
  if (typeof value === "boolean") return { enabled: value, source: "overlay" };
  return { enabled: true, source: "catalog" };
}

/** 目录模型启停：语义同 Agent 启停（仅对目录登记条目有意义）。 */
export async function resolveModelEnabled(
  providerId: string,
  modelId: string,
  reader: OverlayReader,
): Promise<EnabledResolution> {
  const key = `model.${providerId}.${modelId}.enabled`;
  const overlay = await readOverlayCached([key], reader);
  const value = overlay.get(key);
  if (typeof value === "boolean") return { enabled: value, source: "overlay" };
  return { enabled: true, source: "catalog" };
}

/**
 * 角色默认模型三层解析：
 * 1. overlay `{ providerId, modelId }` 且模型已登记 → 即赢；
 * 2. env：LLM_PROVIDER + LLM_<ROLE>_MODEL（模型未登记视为无效继续回落，
 *    执行路径的 fail-fast 语义由 resolveTextModel 保证）；
 * 3. 目录 roleDefaults；env.provider 未登记属于部署错误，抛 unknown_provider。
 */
export async function resolveRoleDefault(
  role: LlmRole,
  reader: OverlayReader,
): Promise<RoleDefaultResolution> {
  const key = `model.roleDefaults.${role}`;
  const overlay = await readOverlayCached([key], reader);
  const overlayValue = overlay.get(key);
  if (isRoleDefaultOverlay(overlayValue) && isModelRegistered(overlayValue.providerId, overlayValue.modelId)) {
    return { providerId: overlayValue.providerId, modelId: overlayValue.modelId, source: "overlay" };
  }

  const config = getLlmConfig();
  const envModel = role === "main" ? config.mainModel : config.summarizerModel;
  if (envModel && isModelRegistered(config.provider, envModel)) {
    return { providerId: config.provider, modelId: envModel, source: "env" };
  }

  const provider = TEXT_PROVIDERS.find((p) => p.providerId === config.provider);
  if (!provider) {
    throw new ModelConfigError(
      `未登记的 LLM 供应商：${config.provider}`,
      "unknown_provider",
    );
  }
  return {
    providerId: provider.providerId,
    modelId: provider.roleDefaults[role],
    source: "catalog",
  };
}
