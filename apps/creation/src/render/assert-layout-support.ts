/**
 * 渲染前版式静态校验。
 *
 * 为什么需要它：渲染器对不受支持的 CSS 是**静默降级**（实测 display:grid /
 * float / var() / position:sticky 均不抛错），只有伪元素选择器会抛错。静默降级
 * 比报错更危险——Agent 拿不到任何信号，会持续产出布局错乱的海报。
 *
 * 因此质量兜底必须前移到这里：命中已知不受支持的属性即拒绝，并把原因结构化
 * 回喂给 Agent 改写。规则见 specs/poster-rendering 的
 * 「不支持的版式属性在渲染前拒绝」。
 */

/** 校验失败：列出命中的不受支持属性（不含 HTML 原文）。 */
export interface LayoutViolation {
  /** 命中的属性名，如 "display: grid"。 */
  property: string;
  /** 该属性在 HTML 中的出现次数。 */
  count: number;
}

export interface LayoutCheckResult {
  ok: boolean;
  violations: LayoutViolation[];
}

/**
 * 已知不受支持的版式规则表。
 * 每条规则：属性描述 + 匹配 HTML 声明的正则。
 *
 * 实测确认的降级项：display:grid / float / var() / position:sticky；
 * 会抛错的项：::before / ::after 等伪元素选择器（提前拦下归入 invalid_html）。
 */
const UNSUPPORTED_RULES: readonly { property: string; pattern: RegExp }[] = [
  {
    property: "display: grid（渲染器只支持 flex 布局）",
    pattern: /display\s*:\s*grid/gi,
  },
  {
    property: "display: inline-grid",
    pattern: /display\s*:\s*inline-grid/gi,
  },
  {
    property: "float（渲染器不支持浮动布局）",
    pattern: /(?<![-\w])float\s*:\s*(left|right|inline-start|inline-end)/gi,
  },
  {
    property: "var() CSS 变量（渲染器不支持自定义属性）",
    pattern: /\bvar\s*\(/gi,
  },
  {
    property: "position: sticky",
    pattern: /position\s*:\s*sticky/gi,
  },
  {
    property: "伪元素选择器 ::before / ::after（渲染器不支持）",
    pattern: /::(before|after|first-line|first-letter|placeholder|selection)/gi,
  },
];

/**
 * 校验 HTML 是否只用受支持的版式属性。
 * 通过则 ok: true；否则返回命中清单，由上层拒绝并回喂。
 */
export function assertLayoutSupport(html: string): LayoutCheckResult {
  const violations: LayoutViolation[] = [];
  for (const rule of UNSUPPORTED_RULES) {
    const matches = html.match(rule.pattern);
    if (matches && matches.length > 0) {
      violations.push({ property: rule.property, count: matches.length });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** 把命中清单拼成可回喂给 Agent 的中文说明（不含 HTML 原文）。 */
export function describeLayoutViolations(result: LayoutCheckResult): string {
  if (result.ok) return "";
  const items = result.violations
    .map((v) => `${v.property}（${v.count} 处）`)
    .join("；");
  return `海报 HTML 使用了渲染器不支持的版式属性：${items}。请改用 flex 布局与内联值重写后重试。`;
}
