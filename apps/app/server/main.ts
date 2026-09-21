import 'reflect-metadata';
import './env';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolveDataDir } from '@wx/shared/node';
import next from 'next';
import { AppModule } from './app.module';
import { configureHttp } from './http';
import { migrate } from './migrate';
import { QueueService } from './queue/queue.service';

async function bootstrap(): Promise<void> {
  const dev = process.argv.includes('--dev');
  const port = Number(process.env.PORT ?? 3000);
  const logger = new Logger('App');
  if (!dev) await migrate();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const web = next({ dev, dir: path.resolve(__dirname, '..'), hostname: '0.0.0.0', port,
    httpServer: app.getHttpServer() });
  let stopping = false;
  const shutdown = async (code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.log('正在停止定时调度，等待当前任务结束…');
    try {
      // 队列停止后才允许 Prisma 断开连接，防止退出时丢失任务执行结果。
      await app.get(QueueService).instance.stop();
      await app.close();
      await web.close();
    } catch (error) {
      logger.error(error);
      code = 1;
    }
    process.exit(code);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  try {
    await web.prepare();
    await configureHttp(app, resolveDataDir(process.env.DATA_DIR), web.getRequestHandler());
    // Nest 初始化时同时启动定时任务；页面、API、图片共用这个 HTTP 服务。
    await app.listen(port, '0.0.0.0');
    logger.log(`应用已启动: http://localhost:${port}`);
  } catch (error) {
    logger.error(error);
    await shutdown(1);
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
