export type VisionAsk = (args: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}) => Promise<string>;

/** OpenAI 兼容的视觉问答；模型来自 EVAL_VLM_MODEL（默认与生产 vision 模型一致）。 */
export function createVlm(opts: { baseUrl: string; apiKey: string; model: string }): VisionAsk {
  return async ({ prompt, imageBase64, mimeType }) => {
    const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      // 视觉模型偶发挂死会拖住整轮评测：给单次调用一个硬超时
      signal: AbortSignal.timeout(Number(process.env.EVAL_VLM_TIMEOUT_MS ?? 60_000)),
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`VLM 调用失败（${res.status}）`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  };
}

/** 归一化：去掉空白与标点差异，只比较字面字符是否都被画出来。 */
export function normalizeForGlyphCheck(s: string): string {
  return s.replace(/\s+/g, "");
}
