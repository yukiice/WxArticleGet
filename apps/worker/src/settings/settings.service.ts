import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveSettings, type ResolvedSettings, type SettingsGroup } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolveAll(): Promise<ResolvedSettings> {
    const keys: SettingsGroup[] = ['llm', 'smtp', 'digest', 'fetch'];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });

    const stored: Partial<Record<SettingsGroup, Record<string, unknown>>> = {};
    for (const row of rows) {
      stored[row.key as SettingsGroup] = (row.value as Record<string, unknown>) ?? {};
    }

    return resolveSettings(stored, (key) => this.config.get<string>(key) ?? undefined);
  }
}

