import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

function run(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.add(child);
  child.once('error', (error) => { console.error(error); stop(1); });
  child.once('exit', () => children.delete(child));
  return child;
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

// 等本包首次编译成功后再运行；不依赖各平台对 shell 中 & 的不同解释。
const compiled = await new Promise((resolve) => run([tsc, '-p', 'tsconfig.server.json']).once('exit', resolve));
if (compiled !== 0) stop(1);
if (!stopping) {
  run([tsc, '-w', '-p', 'tsconfig.server.json', '--preserveWatchOutput']).once('exit', (code) => stop(code ?? 0));
  // 只监视 dist：应用内嵌了 Next dev，它会持续写入 .next/**，
  // 若把 .next 纳入监视范围会触发无限重启（每次页面编译都重启进程）。
  run(['--watch', '--watch-path=dist', '--enable-source-maps', 'dist/main.js', '--dev']).once('exit', (code) => stop(code ?? 0));
}
