import type { Storage } from "./s3";

/** 仅允许访问 assets/ 前缀，杜绝遍历其他对象。 */
const KEY_PREFIX = "assets/";

function isNoSuchKey(err: unknown): boolean {
  const e = err as { name?: string; code?: string } | null;
  return e?.name === "NoSuchKey" || e?.code === "NoSuchKey";
}

function shouldForceAttachment(contentType: string): boolean {
  return (
    contentType === "image/svg+xml" ||
    contentType === "text/html" ||
    contentType.startsWith("text/html")
  );
}

/** 把 S3 Body（Uint8Array / Blob / 可读流）统一转为 Uint8Array。 */
async function toUint8Array(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body && typeof (body as { getReader?: unknown }).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return concat(chunks);
  }
  if (body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return concat(chunks);
  }
  throw new Error("Unsupported storage body type");
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * 构建资产读取响应：
 * - 非 assets/ 前缀 → 403
 * - 不存在 → 404
 * - 普通图片内联（inline），SVG / HTML 强制 attachment 下载，防止内联 XSS
 */
export async function buildAssetResponse(
  key: string,
  storage: Storage,
): Promise<Response> {
  if (!key.startsWith(KEY_PREFIX)) {
    return new Response("Forbidden", { status: 403 });
  }

  let object: Awaited<ReturnType<Storage["getObject"]>>;
  try {
    object = await storage.getObject(key);
  } catch (err) {
    if (isNoSuchKey(err)) return new Response("Not Found", { status: 404 });
    throw err;
  }

  const contentType = object.ContentType ?? "application/octet-stream";
  const disposition = shouldForceAttachment(contentType) ? "attachment" : "inline";

  const body = await toUint8Array(object.Body);
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  if (typeof object.ContentLength === "number") {
    headers.set("Content-Length", String(object.ContentLength));
  }
  // 拷贝为普通 ArrayBuffer 支撑的 Uint8Array，满足新版 TS 的 BodyInit 类型
  const plain = new Uint8Array(body);
  return new Response(plain, { headers });
}
