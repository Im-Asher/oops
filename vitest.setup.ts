// 单元测试在 Node 环境运行，部分被测模块在导入期会读取 env（如 db 客户端）。
// 这里注入最小可用的占位 env，避免配置校验在导入期抛错；不影响集成/真实运行。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_REGION ??= "us-east-1";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.S3_BUCKET ??= "oops-assets";
process.env.OWNER_ID ??= "owner";
process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef-unit-test";
