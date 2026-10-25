export interface SseEvent {
  type: string;
  [k: string]: unknown;
}

/** 帧分隔符：服务端可能用 LF 或 CRLF 空行。 */
const FRAME_SEP = /\r?\n\r?\n/;

/** 从一帧里抠出 data 载荷（多行 data 以 \n 拼接）。 */
function frameData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trimStart())
    .join("\n");
}

/**
 * 解析 `event:`/`data:` 帧；心跳注释行与空帧直接跳过。
 * 流结束时 flush 残留 buffer：末帧缺结尾空行也要解析出来，不能静默丢弃。
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let m = FRAME_SEP.exec(buffer);
    while (m) {
      const frame = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      const data = frameData(frame);
      if (data) {
        try {
          yield JSON.parse(data) as SseEvent;
        } catch {
          // 半帧/坏帧不致命：评测记录异常，不中断整轮
        }
      }
      m = FRAME_SEP.exec(buffer);
    }
  }
  buffer += decoder.decode();

  const tail = frameData(buffer);
  if (tail) {
    try {
      yield JSON.parse(tail) as SseEvent;
    } catch {
      // 末尾残帧解析失败同样不致命
    }
  }
}
