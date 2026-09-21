import 'reflect-metadata';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HealthController } from './health.controller';
import { configureHttp } from './http';

@Controller('private')
class PrivateController {
  @Post()
  echo(@Body() body: unknown) { return body; }
}

@Module({
  controllers: [HealthController, PrivateController],
  providers: [{
    provide: APP_GUARD,
    useValue: new JwtAuthGuard(new Reflector(), {
      verify: async (token: string) => token === 'valid' ? { sub: 'user' } : null,
    } as never, {} as never),
  }],
})
class HttpTestModule {}

describe('同一 HTTP 端口的页面、API 和图片', () => {
  let app: NestExpressApplication;
  let root: string;
  let url: string;
  const imagePath = '/files/images/article/' + 'a'.repeat(24) + '.png';

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'wx-http-'));
    await mkdir(path.join(root, 'images/article'), { recursive: true });
    await writeFile(path.join(root, imagePath.slice('/files/'.length)), 'image');
    app = await NestFactory.create<NestExpressApplication>(HttpTestModule, { logger: false });
    await configureHttp(app, root, async (req, res) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      res.setHeader('Content-Type', 'text/html');
      res.end(body || '<h1>page</h1>');
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('页面保留 HTML，健康检查使用现有 API 格式', async () => {
    expect(await (await fetch(url + '/login')).text()).toBe('<h1>page</h1>');
    expect(await (await fetch(url + '/api/health')).json()).toMatchObject({ code: 0, data: { status: 'ok' } });
  });

  it('API 保留鉴权和 JSON 请求体解析，未知 API 不落入页面处理器', async () => {
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"value":42}' };
    expect((await fetch(url + '/api/private', request)).status).toBe(401);
    const response = await fetch(url + '/api/private', { ...request, headers: { ...request.headers, Cookie: 'wx_token=valid' } });
    expect(await response.json()).toMatchObject({ code: 0, data: { value: 42 } });
    expect((await fetch(url + '/api/missing')).status).toBe(404);
  });

  it('交给页面处理器的 POST 请求体不会被 Nest 提前消耗', async () => {
    const response = await fetch(url + '/page-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"raw"}',
    });
    expect(await response.text()).toBe('{"action":"raw"}');
  });

  it('合法图片可访问，HTML 和目录穿越仍被阻止', async () => {
    const image = await fetch(url + imagePath);
    expect(image.status).toBe(200);
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await fetch(url + '/files/images/article/unsafe.html')).status).toBe(404);
    expect((await fetch(url + '/files/%2e%2e%2f.env')).status).toBe(404);
  });
});
