/**
 * Composer 键盘发送判定（纯函数）：Enter 发送、Shift+Enter 换行、
 * IME 组合期间（composition 或原生 isComposing）不发送。
 */
export function shouldSendOnEnter(input: {
  key: string;
  shiftKey: boolean;
  /** React 合成事件的原生 isComposing。 */
  isComposing?: boolean;
  /** compositionstart～compositionend 之间的本地标记（部分浏览器 keydown 时 isComposing 为 false）。 */
  composing?: boolean;
}): boolean {
  if (input.key !== "Enter" || input.shiftKey) return false;
  return !input.isComposing && !input.composing;
}
