export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface EvalClient {
  login(username: string, password: string): Promise<void>;
  createSession(agentId: string, title?: string): Promise<string>;
  /** 同时返回 `assetId`（喂给 chat）与 `url`（`/files/...`，L2 回填图片字节用）。 */
  uploadReference(
    sessionId: string,
    file: Blob,
    name: string,
  ): Promise<{ assetId: string; url: string }>;
  getFile(url: string): Promise<Uint8Array>;
  chat(body: {
    sessionId: string;
    agentId: string;
    message: string;
    referenceAssetIds?: string[];
  }): Promise<Response>;
}

/** 黑盒 HTTP 客户端：只依赖 apps/web 的公开路由，不 import 任何服务端代码。 */
export function createClient(opts: ClientOptions): EvalClient {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  let cookie = "";

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(cookie ? { cookie } : {}),
    ...extra,
  });

  return {
    async login(username, password) {
      let res: Response;
      try {
        res = await doFetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
      } catch (err) {
        // 服务没起时 fetch 只会抛 "fetch failed"，对使用者没有指向性
        throw new Error(
          `连不上评测服务 ${base}（${(err as Error).message}）：请先启动 apps/web，或用 EVAL_BASE_URL 指定地址`,
        );
      }
      if (!res.ok) throw new Error(`登录失败（${res.status}）：请先运行 pnpm eval:seed`);
      const setCookie = res.headers.get("set-cookie") ?? "";
      cookie = setCookie.split(";")[0] ?? "";
      if (!cookie) throw new Error("登录响应未带 set-cookie");
    },

    async createSession(agentId, title) {
      const res = await doFetch(`${base}/api/sessions`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ agentId, ...(title ? { title } : {}) }),
      });
      if (!res.ok) throw new Error(`建会话失败（${res.status}）`);
      const json = (await res.json()) as { id: string };
      return json.id;
    },

    async uploadReference(sessionId, file, name) {
      const form = new FormData();
      form.append("file", file, name);
      form.append("purpose", "reference");
      form.append("sessionId", sessionId);
      const res = await doFetch(`${base}/upload`, {
        method: "POST",
        headers: headers(),
        body: form,
      });
      if (!res.ok) throw new Error(`参考图上传失败（${res.status}）`);
      const json = (await res.json()) as { assetId: string; url: string };
      return { assetId: json.assetId, url: json.url };
    },

    async getFile(url) {
      const res = await doFetch(`${base}${url}`, { headers: headers() });
      if (!res.ok) throw new Error(`取文件失败（${res.status}）：${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async chat(body) {
      return doFetch(`${base}/api/chat`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
    },
  };
}
