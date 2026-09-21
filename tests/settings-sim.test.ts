import { describe, expect, it } from 'vitest';
import { SECRET_MASK, SETTINGS_KEY, dailyCron, resolveSettings } from '../packages/shared/src';
import { SettingsService } from '../apps/api/src/settings/settings.service';

describe('设置解析（数据库优先，环境变量兜底）', () => {
  it('数据库值优先，环境变量次之，内置默认最后', () => {
    const resolved = resolveSettings(
      { llm: { model: 'db-model' }, smtp: { user: 'db@x.com', pass: 'stored' } },
      (key) => ({ DEEPSEEK_API_KEY: 'env-key', SMTP_USER: 'env@x.com' })[key],
    );
    expect(resolved.llm.model).toBe('db-model');
    expect(resolved.llm.apiKey).toBe('env-key');
    expect(resolved.llm.baseUrl).toBe('https://api.deepseek.com');
    expect(resolved.smtp.port).toBe(465);
    expect(resolved.smtp.user).toBe('db@x.com');
    expect(resolved.fetch.dailyLimitPerAccount).toBe(50);
  });
});

describe('dailyCron 归一化', () => {
  it.each([
    ['09:00', '0 9 * * *'],
    ['24:70', '59 23 * * *'], // 越界钳制
  ])('%s → %s', (input, expected) => {
    expect(dailyCron(input)).toBe(expected);
  });
  it('分钟需两位数；单数字（如 9:5）回退默认 08:00（现有实现行为）', () => {
    expect(dailyCron('9:5')).toBe('0 8 * * *');
  });
  it('非法格式回退默认 08:00', () => {
    expect(dailyCron('  ')).toBe('0 8 * * *');
  });
});

describe('设置更新合并（脱敏值不覆盖真实值，空字符串删除）', () => {
  function fixture() {
    const rows = new Map<string, Record<string, unknown>>([
      ['llm', { apiKey: 'real-key', model: 'deepseek-chat' }],
      ['smtp', {}],
      ['digest', {}],
      ['fetch', {}],
    ]);
    const db = {
      setting: {
        findUnique: async ({ where }: any) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
        upsert: async ({ where, update }: any) => {
          rows.set(where.key, update.value);
          return { key: where.key, value: update.value };
        },
      },
    };
    const config = (key: string) => ({ DEEPSEEK_API_KEY: 'env-key' })[key];
    const service = new SettingsService(db as never, { get: config } as never);
    return { service, row: () => rows.get('llm')! };
  }

  it('掩码占位不写入，清空则删除存储键', async () => {
    const f = fixture();
    // 用户只改 model：apiKey 传掩码不应写坏真实值
    await f.service.update({ llm: { apiKey: SECRET_MASK, model: 'new-model' }, smtp: {}, digest: {}, fetch: {} } as never);
    expect(f.row().apiKey).toBe('real-key');
    expect(f.row().model).toBe('new-model');
    // 主动清空 apiKey：删除存储键，之后回退环境变量兜底
    await f.service.update({ llm: { apiKey: '' }, smtp: {}, digest: {}, fetch: {} } as never);
    expect(f.row().apiKey).toBeUndefined();
  });

  it('view() 用掩码返回密钥并带 has 标记', async () => {
    const f = fixture();
    await f.service.update({ llm: { apiKey: 'fresh-key' }, smtp: {}, digest: {}, fetch: {} } as never);
    const view = await f.service.view();
    expect(view.llm.apiKey).toBe(SECRET_MASK);
    expect(view.llm.hasApiKey).toBe(true);
  });
});
