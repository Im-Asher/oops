import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

/**
 * 把 HTML 中的自有 files 引用（/files/<key>）内联为 data URI。
 * 沙箱默认断网（白名单为空），about:blank 下相对路径也无法解析——
 * 渲染前把产物图（商品图/底图）字节直接内联，是图片进版式的唯一通路。
 * 读取失败的引用保持原样（渲染时请求被拦截，单个资源缺失不致命）。
 */
export async function inlineFileRefs(html: string): Promise<string> {
  const keys = [...new Set([...html.matchAll(/\/files\/([a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?)/g)].map((m) => m[1]))];
  if (keys.length === 0) return html;
  const storage = createStorage(defaultS3Client);
  let out = html;
  for (const key of keys) {
    let dataUri: string;
    try {
      const obj = await storage.getObject(key);
      const bytes = await obj.Body?.transformToByteArray();
      if (!bytes) continue;
      dataUri = `data:${obj.ContentType ?? "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // 单个引用读取失败保持原样：渲染时请求被拦截，资源缺失不致命
      continue;
    }
    out = out.split(`/files/${key}`).join(dataUri);
  }
  return out;
}
