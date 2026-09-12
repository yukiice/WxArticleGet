import { Controller, Get, UseGuards } from '@nestjs/common';
import type { OverviewStatsDto } from '@wx/shared';
import { StatsService } from './stats.service';
import { AdminGuard } from '../auth/admin.guard';

@UseGuards(AdminGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(): Promise<OverviewStatsDto> {
    return this.stats.overview();
  }
}

