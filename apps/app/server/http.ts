import { mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { imageFilesOnly } from './files';

export async function configureHttp(
  app: NestExpressApplication,
  dataDir: string,
  render: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<void> {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await mkdir(dataDir, { recursive: true });
  app.use('/files', imageFilesOnly);
  app.useStaticAssets(dataDir, { prefix: '/files/' });
  // 放在 Nest 的 body parser 之前，保留页面请求/Server Actions 的原始请求体。
  app.use((req: Request, res: Response, forward: NextFunction) => {
    if (/^\/(api|files)(\/|$)/i.test(req.path)) return forward();
    void render(req, res).catch(forward);
  });
}
