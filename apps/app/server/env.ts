import { existsSync } from 'node:fs';
import path from 'node:path';

// Docker 使用 env_file 注入；本地读取应用及仓库根目录配置，已有环境变量优先。
for (const file of ['.env.local', '.env', '../../.env.local', '../../.env']) {
  const filename = path.resolve(__dirname, '..', file);
  if (existsSync(filename)) process.loadEnvFile(filename);
}

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: process.argv.includes('--dev') ? 'development' : 'production' });
}
