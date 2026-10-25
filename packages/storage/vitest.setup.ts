// s3 模块在导入期就经 @oops/config 校验 S3_* 并构造客户端；单测注入占位值，
// 不影响真实运行（真实值仍由 env 层提供）。
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_REGION ??= "us-east-1";
process.env.S3_ACCESS_KEY ??= "test";
process.env.S3_SECRET_KEY ??= "test";
process.env.S3_BUCKET ??= "oops-assets";
