// repo 模块在导入期构造连接池（经 @oops/config 校验 DATABASE_URL）；
// require-user 的验签路径读 AUTH_SECRET（≥32 字符）。
// 单测注入占位值避免导入期抛错；repo 一律被 vi.mock 替换，不触库。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef-unit-test";
