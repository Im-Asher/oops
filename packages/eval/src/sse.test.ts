import { describe, expect, it } from "vitest";
import { parseSseStream } from "./sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("parseSseStream", () => {
  it("按空行切分事件并按 chunk 边界拼装", async () => {
    const s = streamOf([
      'event: message_delta\ndata: {"type":"message_delta","text":"你',
      '好"}\n\n',
      'event: finish\ndata: {"type":"finish","stopReason":"end"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message_delta", text: "你好" });
    expect(events[1]).toMatchObject({ type: "finish" });
  });

  it("忽略注释行（心跳）", async () => {
    const s = streamOf([": ping\n\n", 'event: finish\ndata: {"type":"finish"}\n\n']);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(1);
  });

  it("支持 CRLF 空行作为帧分隔符", async () => {
    const s = streamOf([
      ': ping\r\n\r\nevent: message_delta\r\ndata: {"type":"message_delta","text":"你"}\r\n\r\n',
      'event: finish\r\ndata: {"type":"finish","stopReason":"end"}\r\n\r\n',
    ]);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "message_delta", text: "你" });
    expect(events[1]).toMatchObject({ type: "finish", stopReason: "end" });
  });

  it("流结束时 flush 没有结尾空行的残留帧", async () => {
    const s = streamOf([
      'data: {"type":"message_delta","text":"a"}\n\n',
      'data: {"type":"finish","stopReason":"end"}',
    ]);
    const events = [];
    for await (const e of parseSseStream(s)) events.push(e);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "finish" });
  });
});
