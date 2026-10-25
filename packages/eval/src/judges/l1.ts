import type { Failure } from "../taxonomy";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

export interface L1Input {
  expect: { size: [number, number]; denyCss: string[] };
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

  const actual = pngSize(input.bytes);
  if (!actual) {
    failures.push({ code: "render_error", detail: "产物不是合法 PNG" });
  } else if (actual[0] !== expect.size[0] || actual[1] !== expect.size[1]) {
    failures.push({
      code: "size_mismatch",
      detail: `期望 ${expect.size.join("×")}，实际 ${actual.join("×")}`,
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
