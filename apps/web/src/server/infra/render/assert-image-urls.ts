/**
 * 渲染前图片引用出网闸门。
 *
 * 为什么需要它：渲染器对 `<img src>` 会真实发起网络请求（实测公网地址确实出网）。
 * 若不清洗，Agent 产出的 HTML 可让服务端向任意地址发起 GET——即便上游已拦截
 * 内网与云元数据地址，公网出网这条通道仍会被当作探针或代理滥用。
 *
 * 策略：仅放行内联数据 URI 与白名单 host，其余**剥离**而非报错。
 * 剥离而非拒绝是为了不让 Agent 一次笔误废掉整次渲染与积分链路，与既有
 * 「单个资源缺失不致命」语义一致。
 *
 * ⚠️ 调用顺序：必须在 inlineFileRefs 之前。顺序颠倒会让非法外链先被内联成
 * data URI，从而绕过本闸门。
 */

/** 闸门扫描结果。 */
export interface ImageUrlScan {
  /** 剥离非法引用后的 HTML（其余内容原样保留）。 */
  html: string;
  /** 被剥离的引用数（仅计数，不含 URL 原文，避免日志外泄外链地址）。 */
  strippedCount: number;
}

/**
 * 匹配整个 `<img ...>` 标签（含 src 属性值）。
 * 必须以标签为单位消费：若只匹配 src 属性体，替换后会残留 `>` 形成半个标签，
 * 下游解析会把它当作文本节点（ harmless 但污染输出）。
 */
const IMG_TAG = /<img\b[^>]*>/gi;
/** 从 img 标签内取出 src 值（无 src 返回 undefined）。 */
function imgSrcOf(tag: string): string | undefined {
  const m = /\bsrc\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag);
  return m?.[1];
}
const CSS_URL = /url\(\s*["']?([^"'\s)]+)["']?\s*\)/gi;
/** 判断单个引用是否允许出网。 */
function isAllowedUrl(url: string, allowedHosts: readonly string[]): boolean {
  const trimmed = url.trim();
  if (trimmed === "") return false;
  // 内联数据 URI 一律放行（不入网）
  if (trimmed.startsWith("data:")) return true;
  // 协议相对 URL（//host/x）同样会出网，必须先于「相对路径」判断拦下
  if (trimmed.startsWith("//")) return false;
  // 相对路径（/files/xxx、./xxx）不产生出网请求，由 inlineFileRefs 负责内联或剥离
  if (trimmed.startsWith("/")) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    // 带 scheme：解析 host 后按白名单匹配（hostname 相等或以 .host 结尾）
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    return allowedHosts.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
    );
  }
  // 无 scheme 且非 / 开头（如 example.com/x.png）：视为相对路径，不会出网
  return true;
}

/**
 * 扫描 HTML 中的图片引用，仅放行内联数据 URI 与白名单 host，其余剥离。
 * @param allowedHosts 白名单 host（空 = 仅 data: 放行）
 */
export function assertImageUrls(
  html: string,
  allowedHosts: readonly string[],
): ImageUrlScan {
  let out = html;
  let strippedCount = 0;

  // <img ...>：按整标签消费，非法引用整标签移除
  out = out.replace(IMG_TAG, (tag) => {
    const url = imgSrcOf(tag);
    // 无 src 的 img 不会出网，原样保留
    if (url === undefined) return tag;
    if (isAllowedUrl(url, allowedHosts)) return tag;
    strippedCount += 1;
    // 整标签移除而非仅去掉 src：渲染器遇到无 src 的 <img> 会直接抛
    // "Image source is not provided" 让整次渲染失败，与「资源缺失不致命」相悖。
    return "";
  });

  // CSS url(...)
  out = out.replace(CSS_URL, (match, url: string) => {
    if (isAllowedUrl(url, allowedHosts)) return match;
    strippedCount += 1;
    return "none";
  });

  return { html: out, strippedCount };
}

/**
 * 移除 src 缺失 / 为空 / 全空白的 `<img>` 标签。
 *
 * 为什么需要：渲染器遇到无 src 的 `<img>` 会抛 `Image source is not provided`，
 * 让**整次渲染失败**——而旧的浏览器方案下图裂了照样渲染完整海报。这是无浏览器
 * 迁移引入的回退，必须在这里兜住。
 *
 * 来源：
 * 1. Agent 直接写了 `<img>` 占位却没给 src（没有商品图时想留个位置）；
 * 2. 内联之外的历史遗留路径（`inlineFileRefs` 现在按整标签移除了读不到的引用，
 *    已不再产出 `src=""`，这里作为纵深防线保留）。
 *
 * ⚠️ 调用顺序：必须在 `inlineFileRefs` **之后**——内联若留下空 src 要在这里兜住。
 */
export function stripUnusableImages(html: string): ImageUrlScan {
  let strippedCount = 0;
  const out = html.replace(IMG_TAG, (tag) => {
    const url = imgSrcOf(tag);
    // 有 src 且去空白后非空 → 保留
    if (url !== undefined && url.trim() !== "") return tag;
    strippedCount += 1;
    return "";
  });
  return { html: out, strippedCount };
}
