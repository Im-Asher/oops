// 部分被测模块在导入期读取 env（db 连接池、S3 客户端、模型装配）。
// 只注入占位值，真实运行仍由 env 层提供；单测不触真实服务。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_REGION ??= "us-east-1";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.S3_BUCKET ??= "oops-assets";
process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef-unit-test";
process.env.INTERNAL_TOKEN ??= "unit-test-internal-token-0123456789";
