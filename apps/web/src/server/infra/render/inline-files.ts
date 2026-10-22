import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

/** 内联结果：产物 HTML + 被剥离的引用数（供上层告知 Agent「有图没进去」）。 */
export interface InlineFileRefsResult {
  html: string;
  /**
   * 读取失败被剥离的引用数（按 `<img>` / `url()` 出现次数计）。
   * 这类图不进成品，是「商品图丢失」的唯一可靠信号——不能只靠渲染器报错。
   */
  dropped: number;
}

/** 正则字面量转义（key 含 `.` `-` 等元字符）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 匹配 src 指向某个 /files/<key> 的整个 <img> 标签（属性顺序不限、引号可选）。 */
function imgTagFor(key: string): RegExp {
  return new RegExp(
    `<img\\b[^>]*\\bsrc\\s*=\\s*["']?/files/${escapeRegExp(key)}["']?[^>]*>`,
    "gi",
  );
}

/** 匹配 CSS 里指向某个 /files/<key> 的 url(...) 引用。 */
function cssUrlFor(key: string): RegExp {
  return new RegExp(`url\\(\\s*["']?/files/${escapeRegExp(key)}["']?\\s*\\)`, "gi");
}

/**
 * 把 HTML 中的自有 files 引用（/files/<key>）内联为 data URI。
 *
 * 渲染器不出网且无法解析相对路径，因此产物图（商品图/底图）字节必须直接内联，
 * 这是图片进版式的唯一通路。
 *
 * 读取失败的引用：移除**整个 `<img>` 标签**，而非只抹掉 URL 字符串——后者会留下
 * `src=""`，而渲染器遇到无 src 的 img 会抛 "Image source is not provided" 让整次
 * 渲染失败（旧的浏览器方案下图裂仍能渲染完整海报，这是无浏览器迁移的回退）。
 * CSS 的 `url()` 引用替换为 `none`（无 src 可留，不致命）。剥离数量随结果返回，
 * 否则「商品图没进成品」这件事在渲染成功时无从得知。
 */
export async function inlineFileRefs(html: string): Promise<InlineFileRefsResult> {
  const keys = [...new Set([...html.matchAll(/\/files\/([a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?)/g)].map((m) => m[1]))];
  if (keys.length === 0) return { html, dropped: 0 };
  const storage = createStorage(defaultS3Client);
  let out = html;
  let dropped = 0;
  for (const key of keys) {
    let dataUri: string;
    try {
      const obj = await storage.getObject(key);
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes) {
        const stripped = stripRef(out, key);
        out = stripped.html;
        dropped += stripped.count;
        continue;
      }
      dataUri = `data:${obj.ContentType ?? "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // 读取失败：整标签移除，避免残留 src="" 让渲染器整次失败
      const stripped = stripRef(out, key);
      out = stripped.html;
      dropped += stripped.count;
      continue;
    }
    out = out.split(`/files/${key}`).join(dataUri);
  }
  return { html: out, dropped };
}

/** 剥掉某个失败 key 的所有引用，并报告剥掉了几处（img 标签数 + CSS url 数）。 */
function stripRef(html: string, key: string): { html: string; count: number } {
  const imgs = html.match(imgTagFor(key))?.length ?? 0;
  const urls = html.match(cssUrlFor(key))?.length ?? 0;
  return {
    html: html.replace(imgTagFor(key), "").replace(cssUrlFor(key), "none"),
    count: imgs + urls,
  };
}
