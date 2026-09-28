// 单元测试在 Node 环境运行，部分被测模块在导入期会读取 env（如 db 客户端）。
// 这里注入最小可用的占位 env，避免配置校验在导入期抛错；不影响集成/真实运行。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
process.env.MINIO_ENDPOINT ??= "localhost";
process.env.MINIO_ACCESS_KEY ??= "test";
process.env.MINIO_SECRET_KEY ??= "test";
process.env.MINIO_BUCKET ??= "oops-assets";
process.env.OWNER_ID ??= "owner";
