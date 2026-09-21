import { describe, expect, it, vi } from 'vitest';
import { loginRedirect } from '../apps/app/src/lib/login-redirect';
import { imageFilesOnly } from '../apps/app/server/files';
import { resolveDataDir } from '../packages/shared/src/node';
import path from 'node:path';

describe('登录回跳边界', () => {
  it.each(['javascript:alert(1)', 'https://example.com', '//example.com', '/\\example.com', '/\n/example.com', 'data:text/html,hello'])('拒绝不可信目标 %s', (value) => {
    expect(loginRedirect(value)).toBe('/');
  });
  it('保留站内路径、查询参数和锚点', () => {
    expect(loginRedirect('/articles/a?view=full#part-2')).toBe('/articles/a?view=full#part-2');
  });
});

describe('静态文件边界', () => {
  it.each(['/images/article/0123456789abcdef01234567.html', '/images/article/0123456789abcdef01234567.svg', '/poc/a/content.html'])('拒绝已有的非图片文件 %s', (file) => {
    const response = { sendStatus: vi.fn(), setHeader: vi.fn() };
    const next = vi.fn();
    imageFilesOnly({ path: file } as never, response as never, next);
    expect(response.sendStatus).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
  it('对允许的图片禁用类型嗅探和脚本执行', () => {
    const response = { sendStatus: vi.fn(), setHeader: vi.fn() };
    const next = vi.fn();
    imageFilesOnly({ path: '/images/article/0123456789abcdef01234567.png' } as never, response as never, next);
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Security-Policy', "default-src 'none'; sandbox");
    expect(next).toHaveBeenCalledOnce();
  });
});

it('应用的相对存储配置都以仓库根目录解析', () => {
  expect(resolveDataDir('./data')).toBe(path.resolve(__dirname, '../data'));
  expect(resolveDataDir(path.resolve(__dirname, 'absolute-data'))).toBe(path.resolve(__dirname, 'absolute-data'));
});
