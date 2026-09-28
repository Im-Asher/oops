import { handleUpload } from "@/server/infra/storage/upload";
import { createStorage, defaultS3Client } from "@/server/infra/storage/s3";
import { createAssetRepo } from "@/server/db/asset.repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: { code: "BAD_FORM", message: "请求体须为 multipart/form-data" } },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: { code: "NO_FILE", message: "缺少 file 字段" } },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return handleUpload(
    { bytes, type: file.type, name: file.name },
    { storage: createStorage(defaultS3Client), assets: createAssetRepo() },
  );
}
