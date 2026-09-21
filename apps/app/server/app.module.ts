import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { ArticlesModule } from './articles/articles.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { HealthController } from './health.controller';
import { LogsModule } from './logs/logs.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { StatsModule } from './stats/stats.module';
import { SummariesModule } from './summaries/summaries.module';
import { JobRunnerService } from './queue/job-runner.service';
import { ScheduleService } from './queue/schedule.service';
import { CatalogService } from './tasks/catalog.service';
import { DigestService } from './tasks/digest.service';
import { IngestService } from './tasks/ingest.service';
import { LocalizeService } from './tasks/localize.service';
import { NotifyService } from './tasks/notify.service';
import { SummaryService } from './tasks/summary.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    PrismaModule,
    QueueModule,
    SettingsModule,
    AuthModule,
    AccountsModule,
    ArticlesModule,
    SummariesModule,
    MailModule,
    LogsModule,
    StatsModule,
  ],
  controllers: [HealthController],
  providers: [
    JobRunnerService,
    ScheduleService,
    CatalogService,
    DigestService,
    IngestService,
    LocalizeService,
    NotifyService,
    SummaryService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

