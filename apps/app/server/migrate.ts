import './env';
import { spawn } from 'node:child_process';
import path from 'node:path';

/** 应用启动和部署脚本共用迁移入口，直接使用 DATABASE_URL。 */
export async function migrate(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('请在 .env 中配置 DATABASE_URL，指向已有的 MySQL 数据库');
  const dbDir = path.dirname(require.resolve('@wx/db/package.json'));
  const cli = require.resolve('prisma/build/index.js', { paths: [dbDir] });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy', '--schema', path.join(dbDir, 'prisma/schema.prisma')], {
      stdio: 'inherit', env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`数据库迁移失败（退出码 ${code}），应用未启动`)));
  });
}

if (require.main === module) {
  void migrate().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
