import path from 'node:path';

/** src/dist 均位于 packages/shared 下；相对存储路径统一以仓库根目录为基准。 */
export function resolveDataDir(value = 'data'): string {
  return path.resolve(__dirname, '../../..', value);
}
