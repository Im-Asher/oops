export type FailureCode =
  | "render_error"
  | "css_unsupported"
  | "overflow"
  | "missing_glyph"
  | "text_missing"
  | "image_missing"
  | "no_tool_call"
  | "timeout"
  | "content_rejected"
  | "size_mismatch"
  | "judge_low"
  | "insufficient_credits";

export const FAILURE_LABELS: Record<FailureCode, string> = {
  render_error: "渲染失败",
  css_unsupported: "用了不支持的样式",
  overflow: "版式溢出",
  missing_glyph: "字形缺失",
  text_missing: "该出现的文案没出现",
  image_missing: "没有产出图片",
  no_tool_call: "模型没调用工具",
  timeout: "超时",
  content_rejected: "内容被拒",
  size_mismatch: "尺寸不符",
  judge_low: "审美评分过低",
  insufficient_credits: "评测账号积分不足",
};

export interface Failure {
  code: FailureCode;
  detail: string;
}
