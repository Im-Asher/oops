import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

/**
 * 把 HTML 中的自有 files 引用（/files/<key>）内联为 data URI。
 *
 * 渲染器不出网且无法解析相对路径，因此产物图（商品图/底图）字节必须直接内联，
 * 这是图片进版式的唯一通路。
 *
 * 读取失败的引用从「保持原样」改为**剥离**：无浏览器渲染下残留的相对路径既不可
 * 解析也无请求可拦，留在 HTML 里只会得到一张空图，不如干净移除。
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
      // 单个引用读取失败：剥离该引用，避免残留不可解析的相对路径
      out = out.split(`/files/${key}`).join("");
      continue;
    }
    out = out.split(`/files/${key}`).join(dataUri);
  }
  return out;
}
