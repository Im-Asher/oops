import type { Failure } from "../taxonomy";
import type { VisionAsk } from "../vlm";

const RUBRIC = `你是电商海报评审。按四项各 1-5 分打分：视觉层级、配色克制、留白节奏、商品主体突出。
最后一行只输出 "总分：X/5"，X 为四项平均后四舍五入的整数。不要输出其它格式。`;

export function parseScore(text: string): number | null {
  const m = text.match(/(\d)\s*\/\s*5/) ?? text.match(/^\s*(\d)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : null;
}

export interface L4Result {
  score: number | null;
  reason: string;
  failures: Failure[];
  /** L4 永不作为回归门，调用方据此只记录不阻断。 */
  blocking: false;
}

export async function judgeL4(input: {
  image: Uint8Array;
  mustContain: string[];
  vlm: VisionAsk;
  threshold: number;
  mimeType?: string;
}): Promise<L4Result> {
  const answer = await input.vlm({
    prompt: `${RUBRIC}\n图中应出现的关键文案：${input.mustContain.join("、") || "（无）"}`,
    imageBase64: Buffer.from(input.image).toString("base64"),
    mimeType: input.mimeType ?? "image/png",
  });
  const score = parseScore(answer);
  const failures: Failure[] =
    score !== null && score < input.threshold
      ? [{ code: "judge_low", detail: `审美评分 ${score}/5（阈值 ${input.threshold}）` }]
      : [];
  return { score, reason: answer.trim(), failures, blocking: false };
}
