import { requireUser } from "@/server/auth/require-user";
import { buildAssetResponse } from "@/server/infra/storage/serve";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const { path } = await params;
  const key = path.map((seg) => decodeURIComponent(seg)).join("/");
  return buildAssetResponse(key, createStorage(defaultS3Client));
}
