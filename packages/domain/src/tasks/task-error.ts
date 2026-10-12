/** 任务失败的结构化错误：kind 供工具层映射文案/重试策略，message 回喂模型。 */
export class TaskError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}
