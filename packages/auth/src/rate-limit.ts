const buckets = new Map<string, number[]>();

/** 进程内滑动窗口限频（design D9）：同 key 在窗口内最多 limit 次。多实例部署时需换 Redis。 */
export function rateLimit(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10_000) prune(now - windowMs);
  return true;
}

function prune(olderThan: number): void {
  for (const [key, ts] of buckets) {
    if (!ts.some((t) => t > olderThan)) buckets.delete(key);
  }
}

/** 认证路由的客户端 IP：反代头优先，缺省归并 unknown（单实例 MVP 够用）。 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** 仅供测试重置进程内状态。 */
export function resetRateLimits(): void {
  buckets.clear();
}
