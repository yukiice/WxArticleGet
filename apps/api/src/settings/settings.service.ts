import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SECRET_MASK,
  SETTINGS_KEY,
  resolveSettings,
  type ResolvedDigestConfig,
  type ResolvedFetchConfig,
  type ResolvedLlmConfig,
  type ResolvedSmtpConfig,
  type SettingsUpdateInput,
  type SettingsGroup,
} from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface SettingsView {
  llm: Omit<ResolvedLlmConfig, 'apiKey'> & { apiKey: string; hasApiKey: boolean };
  smtp: Omit<ResolvedSmtpConfig, 'pass'> & { pass: string; hasPass: boolean };
  digest: ResolvedDigestConfig;
  fetch: ResolvedFetchConfig;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async read(key: SettingsGroup): Promise<Record<string, unknown>> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as Record<string, unknown> | undefined) ?? {};
  }

  async resolveAll() {
    const [llm, smtp, digest, fetch] = await Promise.all([
      this.read('llm'),
      this.read('smtp'),
      this.read('digest'),
      this.read('fetch'),
    ]);
    return resolveSettings({ llm, smtp, digest, fetch }, (key) => this.config.get<string>(key) ?? undefined);
  }

  async resolveLlm(): Promise<ResolvedLlmConfig> {
    return (await this.resolveAll()).llm;
  }

  async resolveSmtp(): Promise<ResolvedSmtpConfig> {
    return (await this.resolveAll()).smtp;
  }

  async resolveDigest(): Promise<ResolvedDigestConfig> {
    return (await this.resolveAll()).digest;
  }

  async resolveFetch(): Promise<ResolvedFetchConfig> {
    return (await this.resolveAll()).fetch;
  }

  async view(): Promise<SettingsView> {
    const [llm, smtp, digest, fetch] = await Promise.all([
      this.resolveLlm(),
      this.resolveSmtp(),
      this.resolveDigest(),
      this.resolveFetch(),
    ]);

    return {
      llm: {
        apiKey: llm.apiKey ? SECRET_MASK : '',
        hasApiKey: Boolean(llm.apiKey),
        baseUrl: llm.baseUrl,
        model: llm.model,
        temperature: llm.temperature,
        maxInputCharsPerArticle: llm.maxInputCharsPerArticle,
      },
      smtp: {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        from: smtp.from,
        pass: smtp.pass ? SECRET_MASK : '',
        hasPass: Boolean(smtp.pass),
      },
      digest,
      fetch,
    };
  }

  async update(input: SettingsUpdateInput): Promise<SettingsView> {
    await Promise.all(
      (['llm', 'smtp', 'digest', 'fetch'] as const).map(async (group) => {
        const patch = input[group];
        if (!patch) return;

        const current = await this.read(SETTINGS_KEY[group]);
        const merged: Record<string, unknown> = { ...current };

        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          if ((key === 'apiKey' || key === 'pass') && value === SECRET_MASK) continue;
          if ((key === 'apiKey' || key === 'pass') && value === '') {
            delete merged[key];
            continue;
          }
          if (typeof value === 'string' && value.trim() === '') {
            delete merged[key];
            continue;
          }
          merged[key] = value;
        }

        await this.prisma.setting.upsert({
          where: { key: SETTINGS_KEY[group] },
          create: { key: SETTINGS_KEY[group], value: merged as never },
          update: { value: merged as never },
        });
      }),
    );

    return this.view();
  }
}
