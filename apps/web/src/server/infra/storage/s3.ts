import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getS3Config } from "@oops/config";

/** 仅用到 S3Client 的子集，便于单元测试以假对象注入。 */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

const s3Config = getS3Config();

export const defaultS3Client = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  forcePathStyle: s3Config.forcePathStyle,
  credentials: {
    accessKeyId: s3Config.accessKey,
    secretAccessKey: s3Config.secretKey,
  },
});

/** 生成对象 key：assets/<uuid>.<ext>（ext 可来自后缀或 mime）。 */
export function generateAssetKey(ext: string): string {
  const clean = ext.replace(/^[.]/, "").toLowerCase() || "bin";
  return `assets/${randomUUID()}.${clean}`;
}

export function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "application/json": "json",
  };
  return map[mime] ?? "bin";
}

export interface Storage {
  putObject(key: string, body: Uint8Array | Buffer, contentType: string): Promise<string>;
  getObject(key: string): Promise<GetObjectCommandOutput>;
  /** 删除对象。S3 语义下删除不存在的 key 同样成功（204），天然幂等。 */
  removeObject(key: string): Promise<void>;
}

export function createStorage(client: S3Like = defaultS3Client): Storage {
  const bucket = s3Config.bucket;
  return {
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return key;
    },

    async getObject(key) {
      return (await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )) as GetObjectCommandOutput;
    },

    async removeObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
