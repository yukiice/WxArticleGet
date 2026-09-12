import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// 与 apps/api、apps/worker 保持一致：本地开发时统一从 monorepo 根目录的 .env 读取配置。
// 容器 / CI 场景下环境变量已由编排工具注入，此处无需（也找不到）该文件。
const rootEnvFile = path.resolve(process.cwd(), '../../.env');

if (existsSync(rootEnvFile)) {
  for (const line of readFileSync(rootEnvFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

// 这里刻意不声明 datasource：连接串继续由 prisma/schema.prisma 里的 env("DATABASE_URL") 解析，
// 使得 `prisma generate` 在无数据库环境（如镜像构建阶段）也能执行。
export default defineConfig({
  schema: path.resolve(process.cwd(), 'prisma/schema.prisma'),
  migrations: {
    path: path.resolve(process.cwd(), 'prisma/migrations'),
  },
});
