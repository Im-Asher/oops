import type { Failure } from "../taxonomy";
import { normalizeForGlyphCheck, type VisionAsk } from "../vlm";

export interface L3Input {
  domText: string;
  mustContain: string[];
  image: Uint8Array;
  vlm: VisionAsk;
  mimeType?: string;
}

/**
 * L3：该出现的文案是否真的被画出来了。
 * DOM 有而图里读不到 = 字形缺失（生产环境里汉字超出字体子集时正是这个表现）。
 */
export async function judgeL3(input: L3Input): Promise<{ pass: boolean; failures: Failure[] }> {
  const failures: Failure[] = [];
  if (input.mustContain.length === 0) return { pass: true, failures };

  const dom = normalizeForGlyphCheck(input.domText);
  const missingDom = input.mustContain.filter((t) => !dom.includes(normalizeForGlyphCheck(t)));
  for (const t of missingDom) {
    failures.push({ code: "text_missing", detail: `DOM 中找不到「${t}」` });
  }
  if (missingDom.length === input.mustContain.length) return { pass: false, failures };

  const readBack = normalizeForGlyphCheck(
    await input.vlm({
      prompt:
        "逐字读出这张图里的所有文字，按视觉顺序，用换行分隔。不要描述、不要补全、不要纠错，只抄你看到的字。",
      imageBase64: Buffer.from(input.image).toString("base64"),
      mimeType: input.mimeType ?? "image/png",
    }),
  );

  for (const t of input.mustContain) {
    if (missingDom.includes(t)) continue;
    if (!readBack.includes(normalizeForGlyphCheck(t))) {
      failures.push({
        code: "missing_glyph",
        detail: `「${t}」在 DOM 中存在但图中读不到（疑似缺字形）`,
      });
    }
  }
  return { pass: failures.length === 0, failures };
}
