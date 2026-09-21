import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { settingsUpdateSchema } from '@wx/shared';
import { AdminGuard } from '../auth/admin.guard';
import { parseOrThrow } from '../common/zod';
import { SettingsService, type SettingsView } from './settings.service';

@UseGuards(AdminGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<SettingsView> {
    return this.settings.view();
  }

  @Put()
  update(@Body() body: unknown): Promise<SettingsView> {
    return this.settings.update(parseOrThrow(settingsUpdateSchema, body));
  }
}
