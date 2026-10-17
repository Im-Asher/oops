/**
 * 解析 Origin/Referer 头的 host 部分。
 * 返回 null = 头不存在；"invalid" = 头存在但不可解析（如沙箱 iframe 的 Origin: null）。
 */
function headerHost(
  req: Request,
  name: "origin" | "referer",
): string | null | "invalid" {
  const value = req.headers.get(name);
  if (value === null) return null;
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

/**
 * 同源校验（CSRF 防护）：浏览器发起的跨站请求会带外站 Origin/Referer。
 * - 头不存在（curl 等非浏览器客户端）：不构成浏览器 CSRF 向量，放行
 * - 头存在但不可解析：无法证明同源，拒绝（沙箱 iframe 的 Origin: null 属此类）
 * - host 与请求目标 host 不一致：跨源，拒绝
 *   （目标 host 取 Host 头，缺失时兜底 req.url 的 host——undici 构造的
 *   Request 会过滤受管头 Host，Next 运行时两者一致）
 */
export function isSameOrigin(req: Request): boolean {
  let originHost = headerHost(req, "origin");
  if (originHost === null) originHost = headerHost(req, "referer");
  if (originHost === null) return true;
  if (originHost === "invalid") return false;
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return originHost === host;
}
