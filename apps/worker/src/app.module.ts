import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JobRunnerService } from './queue/job-runner.service';
import { QueueProvider } from './queue/queue.provider';
import { ScheduleService } from './queue/schedule.service';
import { PrismaModule } from './prisma/prisma.module';
import { CatalogService } from './services/catalog.service';
import { DigestService } from './services/digest.service';
import { IngestService } from './services/ingest.service';
import { LocalizeService } from './services/localize.service';
import { NotifyService } from './services/notify.service';
import { SummaryService } from './services/summary.service';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local', '../../.env'],
    }),
    PrismaModule,
    SettingsModule,
  ],
  providers: [
    QueueProvider,
    LocalizeService,
    NotifyService,
    IngestService,
    SummaryService,
    DigestService,
    CatalogService,
    JobRunnerService,
    ScheduleService,
  ],
})
export class AppModule {}

