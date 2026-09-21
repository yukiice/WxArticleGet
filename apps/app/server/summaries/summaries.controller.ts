import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { dateKey, summaryQuerySchema, summaryRunSchema, type SummaryDto } from '@wx/shared';
import { AdminGuard } from '../auth/admin.guard';
import { parseOrThrow } from '../common/zod';
import { SummariesService } from './summaries.service';

@Controller('summaries')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  async list(@Query() query: unknown): Promise<{ date: string; summary: SummaryDto | null; recent: SummaryDto[] }> {
    const input = parseOrThrow(summaryQuerySchema, query);
    const date = input.date ?? dateKey();
    const [summary, recent] = await Promise.all([this.summaries.byDate(date), this.summaries.recent()]);
    return { date, summary, recent };
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<SummaryDto> {
    return this.summaries.detail(id);
  }

  @UseGuards(AdminGuard)
  @Post('run')
  run(@Body() body: unknown): Promise<{ queued: boolean; date: string }> {
    const input = parseOrThrow(summaryRunSchema, body ?? {});
    return this.summaries.run(input.date, input.force);
  }
}

