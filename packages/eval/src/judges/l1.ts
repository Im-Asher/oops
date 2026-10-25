import type { Failure } from "../taxonomy";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** SOF0(基线) / SOF1(扩展顺序) / SOF2(渐进)：都带尺寸。 */
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

export interface ImageSize {
  width: number;
  height: number;
  format: "png" | "jpeg";
}

function pngSizeOf(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 顺序扫 JPEG 段，遇到 SOFn 读高（+5, 2 bytes BE）与宽（+7）；不支持其它段结构则放弃。 */
function jpegSizeOf(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 跳过 SOI 与可能存在的填充 0xFF
  let offset = 2;
  while (offset + 1 < bytes.length) {
    // 段必须以 0xFF 开头；填充 0xFF 是合法的
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset] as number;
    offset += 1;
    // 无载荷段：TEM、RST0-7、SOI、EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) return null;
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    // SOS 之后是熵编码数据，正常情况下 SOFn 一定在其之前出现
    if (marker === 0xda) return null;
    offset += length;
  }
  return null;
}

/** 从产物字节读出图片宽高；只认 PNG 与 JPEG，其它格式返回 null。 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const png = pngSizeOf(bytes);
  if (png) return { ...png, format: "png" };
  const jpeg = jpegSizeOf(bytes);
  if (jpeg) return { ...jpeg, format: "jpeg" };
  return null;
}

/** PNG 专用包装，保留给需要强制 PNG 的调用方（参考图校验等）。 */
export function pngSize(bytes: Uint8Array): [number, number] | null {
  const s = pngSizeOf(bytes);
  return s ? [s.width, s.height] : null;
}

export interface L1Input {
  expect: {
    size: [number, number];
    denyCss: string[];
    /** 存在时：校验宽度 == size[0] 且实际高度属于该集合（高度档位由模型自选）。 */
    allowedHeights?: number[] | undefined;
  };
  artifacts: { assetUrl: string | null; size: [number, number] | null; html: string | null };
  bytes: Uint8Array | null;
}

export interface JudgeResult {
  pass: boolean;
  failures: Failure[];
}

/** L1 纯计算判定：不触网、不启浏览器。 */
export function judgeL1(input: L1Input): JudgeResult {
  const failures: Failure[] = [];
  const { artifacts, expect } = input;

  if (!artifacts.assetUrl || !input.bytes) {
    failures.push({ code: "image_missing", detail: "本轮没有产出图片" });
    return { pass: false, failures };
  }

  const actual = imageSize(input.bytes);
  if (!actual) {
    failures.push({ code: "render_error", detail: "产物格式无法识别（仅支持 PNG/JPEG）" });
  } else if (expect.allowedHeights && expect.allowedHeights.length > 0) {
    const [wantWidth] = expect.size;
    if (actual.width !== wantWidth || !expect.allowedHeights.includes(actual.height)) {
      failures.push({
        code: "size_mismatch",
        detail: `期望宽 ${wantWidth}、高度∈[${expect.allowedHeights.join("/")}]，实际 ${actual.width}×${actual.height}`,
      });
    }
  } else if (actual.width !== expect.size[0] || actual.height !== expect.size[1]) {
    failures.push({
      code: "size_mismatch",
      detail: `期望 ${expect.size.join("×")}，实际 ${actual.width}×${actual.height}`,
    });
  }

  const html = artifacts.html ?? "";
  for (const needle of expect.denyCss) {
    if (html.includes(needle)) {
      failures.push({ code: "css_unsupported", detail: `HTML 命中禁用样式 ${needle}` });
    }
  }

  return { pass: failures.length === 0, failures };
}
