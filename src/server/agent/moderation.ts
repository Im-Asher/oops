/**
 * 入口级敏感词初筛：在请求进入 LLM 前拦截明显违规输入。
 * 列表刻意保持最小（MVP 自用），具体词表由策略层补充；测试可注入自定义正则。
 */
export const DEFAULT_BLOCKLIST: RegExp[] = [];

/** 命中返回拦截原因，否则返回 null（请求尚未进入 LLM）。 */
export function screenInput(text: string, patterns: RegExp[] = DEFAULT_BLOCKLIST): string | null {
  for (const re of patterns) {
    if (re.test(text)) return "输入包含受限内容，已被系统拦截";
  }
  return null;
}
