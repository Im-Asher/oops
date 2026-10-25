export interface SseEvent {
  type: string;
  [k: string]: unknown;
}

/** 解析 `event:`/`data:` 帧；心跳注释行与空帧直接跳过。 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          yield JSON.parse(data) as SseEvent;
        } catch {
          // 半帧/坏帧不致命：评测记录异常，不中断整轮
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
}
