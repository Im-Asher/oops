import { buildAssetResponse } from "@/server/infra/storage/serve";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const key = path.map((seg) => decodeURIComponent(seg)).join("/");
  return buildAssetResponse(key, createStorage(defaultS3Client));
}
