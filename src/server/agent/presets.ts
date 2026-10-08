import type { Messages } from "@/i18n/messages";

/**
 * 灵感卡 presets 解析（add-i18n 3.2）：Agent definitions 中的 presets 是
 * 词典 key（chat.presets.<agentId>.<key>），由 /api/agents 按请求 locale
 * 解析为面向用户的示例需求文案——en 词典以英文撰写（非直译）。
 */

/** 把 presets key 数组解析为词典文案；未登记的 agentId 或 key 原样透传（防御性）。 */
export function resolvePresets(messages: Messages, agentId: string, keys: string[]): string[] {
  const table = messages.chat.presets[agentId as keyof Messages["chat"]["presets"]];
  if (!table) return keys;
  return keys.map((key) => (table as Record<string, string>)[key] ?? key);
}
