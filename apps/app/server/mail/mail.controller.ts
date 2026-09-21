import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { recipientCreateSchema, testMailSchema, type Paginated, type SendLogDto } from '@wx/shared';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { parseOrThrow } from '../common/zod';
import { MailService } from './mail.service';

const dateQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@UseGuards(AdminGuard)
@Controller('email')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('recipients')
  recipients() {
    return this.mail.listRecipients();
  }

  @Post('recipients')
  addRecipient(@Body() body: unknown) {
    return this.mail.createRecipient(parseOrThrow(recipientCreateSchema, body));
  }

  @Delete('recipients/:id')
  removeRecipient(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.mail.removeRecipient(id);
  }

  @Post('test')
  test(@Body() body: unknown): Promise<{ sent: boolean; to: string[] }> {
    const input = parseOrThrow(testMailSchema, body ?? {});
    return this.mail.sendTest(input.to);
  }

  @Post('send')
  send(@Query() query: unknown): Promise<{ queued: boolean }> {
    const input = parseOrThrow(dateQuerySchema, query ?? {});
    return this.mail.sendNow(input.date);
  }

  @Get('logs')
  logs(@Query() query: unknown): Promise<Paginated<SendLogDto>> {
    const input = parseOrThrow(paginationSchema, query ?? {});
    return this.mail.logs(input.page, input.pageSize);
  }
}

