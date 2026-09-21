import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { accountLookupSchema, createAccountSchema, fetchTriggerSchema, updateAccountSchema, type AccountCandidate, type AccountDto } from '@wx/shared';
import { AdminGuard } from '../auth/admin.guard';
import { parseOrThrow } from '../common/zod';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(): Promise<AccountDto[]> {
    return this.accounts.list();
  }

  @UseGuards(AdminGuard)
  @Get('catalog')
  catalog(): Promise<{ count: number; lastSyncedAt: string | null }> {
    return this.accounts.catalogStatus();
  }

  @UseGuards(AdminGuard)
  @Post('catalog/sync')
  syncCatalog(): Promise<{ queued: boolean }> {
    return this.accounts.syncCatalog();
  }

  @UseGuards(AdminGuard)
  @Post('lookup')
  lookup(@Body() body: unknown): Promise<AccountCandidate[]> {
    const input = parseOrThrow(accountLookupSchema, body);
    return this.accounts.lookup(input.keyword);
  }

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() body: unknown): Promise<AccountDto> {
    return this.accounts.create(parseOrThrow(createAccountSchema, body));
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<AccountDto> {
    return this.accounts.update(id, parseOrThrow(updateAccountSchema, body));
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.accounts.remove(id);
  }

  @UseGuards(AdminGuard)
  @Post(':id/fetch')
  fetch(@Param('id') id: string, @Query() query: unknown): Promise<{ queued: boolean }> {
    const input = parseOrThrow(fetchTriggerSchema, query);
    return this.accounts.triggerFetch(id, input.sinceDays);
  }
}

