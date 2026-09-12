import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { JobLogDto, Paginated } from '@wx/shared';
import { LogsService } from './logs.service';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get('jobs')
  jobs(@Query() query: unknown): Promise<Paginated<JobLogDto>> {
    return this.logs.jobs(query ?? {});
  }
}

