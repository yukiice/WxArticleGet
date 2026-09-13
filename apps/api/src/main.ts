import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { resolveDataDir } from '@wx/shared/node';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { imageFilesOnly } from './files';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const dataDir = resolveDataDir(config.get<string>('DATA_DIR'));
  await mkdir(dataDir, { recursive: true });
  app.use('/files', imageFilesOnly);
  app.useStaticAssets(dataDir, { prefix: '/files/' });

  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`API 已启动: http://localhost:${port}/api （静态资源 /files）`);
}

void bootstrap();

