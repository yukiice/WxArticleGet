import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// 与 apps/app 保持一致：本地开发时统一从 monorepo 根目录的 .env 读取配置。
// 容器 / CI 场景下环境变量已由编排工具注入，此处无需（也找不到）该文件。
const rootEnvFile = path.resolve(process.cwd(), '../../.env');

if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

// 这里刻意不声明 datasource：连接串继续由 prisma/schema.prisma 里的 env("DATABASE_URL") 解析，
// 使得 `prisma generate` 在无数据库环境（如镜像构建阶段）也能执行。
export default defineConfig({
  schema: path.resolve(process.cwd(), 'prisma/schema.prisma'),
  migrations: {
    path: path.resolve(process.cwd(), 'prisma/migrations'),
  },
});
