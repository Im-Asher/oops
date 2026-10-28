import type { SseEvent } from "./sse";

export interface ToolError {
  code: string;
  message: string;
}

export interface RunArtifacts {
  html: string | null;
  assetUrl: string | null;
  size: [number, number] | null;
  toolErrors: ToolError[];
  toolCalls: { name: string; args: unknown }[];
  stopReason: string | null;
  fatal: string | null;
  text: string;
}

const IMAGE_TOOLS = new Set(["render_html", "generate_image"]);

/** 从事件流提取评测所需的一切；纯函数，便于单测。 */
export function collectFromEvents(events: SseEvent[]): RunArtifacts {
  const out: RunArtifacts = {
    html: null,
    assetUrl: null,
    size: null,
    toolErrors: [],
    toolCalls: [],
    stopReason: null,
    fatal: null,
    text: "",
  };
  for (const e of events) {
    if (e.type === "message_delta") out.text += String(e.text ?? "");
    else if (e.type === "tool_start") {
      out.toolCalls.push({ name: String(e.name), args: e.args });
      if (e.name === "render_html") {
        const args = e.args as { html?: string } | null;
        if (args?.html) out.html = args.html;
      }
    } else if (e.type === "tool_end") {
      const d = (e.details ?? null) as Record<string, unknown> | null;
      if (d && typeof d.error === "string") {
        out.toolErrors.push({ code: d.error, message: String(d.message ?? "") });
      } else if (d && typeof d.url === "string" && IMAGE_TOOLS.has(String(e.name))) {
        out.assetUrl = d.url;
        out.size = [Number(d.width), Number(d.height)];
      }
    } else if (e.type === "finish") out.stopReason = String(e.stopReason ?? "");
    else if (e.type === "error") out.fatal = String(e.message ?? "unknown");
  }
  return out;
}
