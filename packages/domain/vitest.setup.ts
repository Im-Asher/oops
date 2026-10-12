// executor 导入 @oops/db 仓储，间接在导入期构造连接池（经 @oops/config 校验 DATABASE_URL）。
// 单测注入占位连接串避免导入期抛错；单元测试用注入 repo/mock，不触真实库。
process.env.DATABASE_URL ??= "postgresql://oops:oops@localhost:5432/oops";
