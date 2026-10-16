// repo 模块在导入期构造连接池（经 @oops/config 校验 DATABASE_URL）。
// 单测注入占位连接串避免导入期抛错；mock-db 会替换真实连接，不触库。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
