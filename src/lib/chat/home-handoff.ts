/**
 * 首页直发衔接的待传附件暂存（模块级单例）。
 * File 对象不可序列化、无法走 URL 参数，只能在 SPA 跳转期间以内存承载；
 * 画布页建会话后取走消费（经 /upload purpose=reference 上传，与画布手动
 * 上传参考图同链路）。跳转瞬间刷新页面会丢失——接受的已知边缘，文本草稿
 * 经 ?draft= 仍在（spec/home-landing「携带附件直发」）。
 *
 * staged 标记用于画布侧判别「刷新丢附件」：URL 的 send 参数在刷新后仍在，
 * 但模块内存已清零——此时降级为「草稿回填不直发」（spec 直发衔接进入场景）。
 */

let pendingFiles: File[] = [];
let staged = false;

export function setPendingHandoffFiles(files: File[]): void {
  // 浅拷贝：与生产方（首页 React state）数组解耦，防原地变更污染暂存。
  pendingFiles = [...files];
  staged = true;
}

/** 是否存在未消费的衔接暂存（刷新后为 false）。 */
export function hasPendingHandoff(): boolean {
  return staged;
}

export function getPendingHandoffFiles(): File[] {
  return pendingFiles;
}

/** 取走并清空：消费点一次性接管，避免残留导致下次进入误发。 */
export function takePendingHandoffFiles(): File[] {
  const files = pendingFiles;
  pendingFiles = [];
  staged = false;
  return files;
}
