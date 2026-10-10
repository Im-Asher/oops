import {
  createImagesModels,
  createImagesProvider,
  envApiKeyAuth,
  type AssistantImages,
  type ImagesContext,
  type ImagesModel,
  type ImagesOptions,
  type MutableImagesModels,
} from "@earendil-works/pi-ai";
import { IMAGE_ENDPOINT, IMAGE_MODELS, QWEN_TOKEN_PLAN_CN_API_KEY } from "@/lib/config";
import { findImageProvider } from "@/server/llm/catalog";

// 常量来源改为模型目录（llm-assembly spec）；导出保持不变，消费方无感。
// 兜底字面量仅为类型收窄，catalog.test 已锁条目存在性与取值一致。
const imageEntry = findImageProvider("dashscope-token-plan");
export const DASHSCOPE_IMAGE_PROVIDER = imageEntry?.providerId ?? "dashscope-token-plan";
export const DASHSCOPE_IMAGE_MODEL = imageEntry?.defaultModelId ?? "wan2.7-image";

export type ImageGenErrorKind = "content_rejected" | "rate_limited" | "timeout" | "unknown";

export interface ImageGenError {
  kind: ImageGenErrorKind;
  message: string;
  retryable: boolean;
}

export interface ImageGenResult {
  ok: true;
  data: string;
  mimeType: string;
  url?: string;
}

export type GenerateImageOutcome = ImageGenResult | { ok: false; error: ImageGenError };

const PROVIDER_AUTH = {
  apiKey: envApiKeyAuth("Qwen Token Plan (CN)", ["QWEN_TOKEN_PLAN_CN_API_KEY"]),
};

/** 将 HTTP 状态/响应体归一到四类错误：审核 / 限流 / 超时 / 未知。 */
export function classifyImageGenError(status: number, body: unknown): ImageGenError {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const lowered = text.toLowerCase();
  if (status === 429 || /\brate[\s_-]?limit|quota|too many requests/i.test(lowered)) {
    return { kind: "rate_limited", message: "图像服务限流，请稍后重试", retryable: true };
  }
  if (
    status === 400 &&
    /(content|sensitive|审核|政治|nsfw|inappropriate|违规)/i.test(lowered)
  ) {
    return { kind: "content_rejected", message: "内容未通过安全审核", retryable: false };
  }
  if (/timeout|timed out|504|deadline|上游.*超时/i.test(lowered)) {
    return { kind: "timeout", message: "图像生成超时", retryable: true };
  }
  return { kind: "unknown", message: text.slice(0, 200) || `HTTP ${status}`, retryable: true };
}

function errorAssistant(modelId: string, error: ImageGenError): AssistantImages {
  return {
    api: DASHSCOPE_IMAGE_PROVIDER,
    provider: DASHSCOPE_IMAGE_PROVIDER,
    model: modelId,
    output: [{ type: "text", text: `图像生成失败：${error.message}` }],
    stopReason: "error",
    errorMessage: error.message,
    timestamp: Date.now(),
  };
}

async function toBase64FromUrl(url: string, signal?: AbortSignal): Promise<GenerateImageOutcome> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return {
        ok: false,
        error: { kind: "unknown", message: `下载生成图失败：HTTP ${res.status}`, retryable: true },
      };
    }
    const mimeType = res.headers.get("content-type") ?? "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (const b of buf) binary += String.fromCharCode(b);
    return { ok: true, data: btoa(binary), mimeType };
  } catch (err) {
    return {
      ok: false,
      error: { kind: "timeout", message: `下载生成图失败：${(err as Error)?.message ?? ""}`, retryable: true },
    };
  }
}

function buildProvider() {
  const api = {
    async generateImages(
      model: ImagesModel<string>,
      context: ImagesContext,
      options?: ImagesOptions,
    ): Promise<AssistantImages> {
      const prompt = context.input
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      const meta = (options?.metadata ?? {}) as { size?: string; aspectRatio?: string };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const apiKey = options?.apiKey ?? QWEN_TOKEN_PLAN_CN_API_KEY;
        const res = await fetch(IMAGE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(options?.headers ?? {}),
          },
          body: JSON.stringify({
            model: model.id,
            input: {
              messages: [{ role: "user", content: [{ text: prompt }] }],
            },
            parameters: {
              size: meta.size,
              n: 1,
            },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          const error = classifyImageGenError(res.status, body);
          return errorAssistant(model.id, error);
        }

        const data = (await res.json()) as {
          output?: {
            choices?: { message?: { content?: { image?: string; type?: string }[] } }[];
            finish_reason?: string;
          };
        };
        const content = data.output?.choices?.[0]?.message?.content ?? [];
        const imageBlock = content.find((c) => c?.image);
        if (!imageBlock?.image) {
          return errorAssistant(model.id, {
            kind: "unknown",
            message: `响应缺少图像数据：${JSON.stringify(data).slice(0, 200)}`,
            retryable: true,
          });
        }
        const raw = imageBlock.image;
        const isUrl = raw.startsWith("http://") || raw.startsWith("https://");
        const result = isUrl
          ? await toBase64FromUrl(raw, controller.signal)
          : ({ ok: true, data: raw, mimeType: "image/png" } as const);
        if (!result.ok) {
          return errorAssistant(model.id, result.error);
        }
        return {
          api: DASHSCOPE_IMAGE_PROVIDER,
          provider: DASHSCOPE_IMAGE_PROVIDER,
          model: model.id,
          output: [{ type: "image", data: result.data, mimeType: result.mimeType }],
          stopReason: "stop",
          timestamp: Date.now(),
        };
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        const error: ImageGenError = aborted
          ? { kind: "timeout", message: "图像生成超时", retryable: true }
          : { kind: "unknown", message: (err as Error)?.message ?? "图像生成异常", retryable: true };
        return errorAssistant(model.id, error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };

  const model: ImagesModel<typeof DASHSCOPE_IMAGE_PROVIDER> = {
    id: DASHSCOPE_IMAGE_MODEL,
    name: "Wan2.7 Image",
    api: DASHSCOPE_IMAGE_PROVIDER,
    provider: DASHSCOPE_IMAGE_PROVIDER,
    output: ["image"],
  } as ImagesModel<typeof DASHSCOPE_IMAGE_PROVIDER>;

  return createImagesProvider({
    id: DASHSCOPE_IMAGE_PROVIDER,
    name: "DashScope Token Plan",
    auth: PROVIDER_AUTH,
    models: [model],
    api,
  });
}

let imagesModels: MutableImagesModels | undefined;

/** 惰性装配图像生成 Models（仅注册 dashscope-token-plan）。 */
export function getImagesModels(): MutableImagesModels {
  if (!imagesModels) {
    const m = createImagesModels();
    m.setProvider(buildProvider());
    imagesModels = m;
  }
  return imagesModels;
}

/**
 * 调用 DashScope 生成一张图，返回 base64 结果。
 * 拒绝未登记模型（白名单外）与缺失 key。
 */
export async function generateImage(
  args: { prompt: string; size: string; aspectRatio: string },
  signal?: AbortSignal,
): Promise<GenerateImageOutcome> {
  if (!IMAGE_MODELS.includes(DASHSCOPE_IMAGE_MODEL)) {
    return {
      ok: false,
      error: { kind: "unknown", message: `未登记的图像模型：${DASHSCOPE_IMAGE_MODEL}`, retryable: false },
    };
  }
  const model = getImagesModels().getModel(DASHSCOPE_IMAGE_PROVIDER, DASHSCOPE_IMAGE_MODEL);
  if (!model) {
    return {
      ok: false,
      error: { kind: "unknown", message: "图像模型未就绪", retryable: false },
    };
  }
  const result = await getImagesModels().generateImages(
    model,
    { input: [{ type: "text", text: args.prompt }] },
    { metadata: { size: args.size, aspectRatio: args.aspectRatio }, signal },
  );
  if (result.stopReason === "error") {
    return {
      ok: false,
      error: {
        kind: "unknown",
        message: result.errorMessage ?? "图像生成失败",
        retryable: true,
      },
    };
  }
  const image = result.output.find((c) => c.type === "image");
  if (!image || image.type !== "image") {
    return { ok: false, error: { kind: "unknown", message: "响应缺少图像", retryable: true } };
  }
  return { ok: true, data: image.data, mimeType: image.mimeType };
}
