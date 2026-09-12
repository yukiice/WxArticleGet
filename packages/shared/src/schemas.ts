import { z } from 'zod';
import { ACCOUNT_STATUS, PROVIDER_TYPE } from './constants';

export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});
export type LoginInput = z.infer<typeof loginSchema>;

const newPasswordField = z.string().min(8, '新密码至少 8 位').max(72, '密码过长');

const usernameField = z
  .string()
  .trim()
  .min(2, '用户名至少 2 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[\w\u4e00-\u9fa5-]+$/, '用户名只能包含字母、数字、下划线、中文或短横线');

export const createUserSchema = z
  .object({
    username: usernameField,
    password: newPasswordField,
    confirmPassword: z.string().min(1, '请再次输入密码'),
    role: z.enum(['admin', 'member']).default('member'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  role: z.enum(['admin', 'member']),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword'],
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: '新密码不能与当前密码相同',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const articleQuerySchema = paginationSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().optional(),
  q: z.string().trim().min(1).optional(),
  isRead: z.enum(['true', 'false']).optional(),
});
export type ArticleQuery = z.infer<typeof articleQuerySchema>;

export const accountLookupSchema = z.object({
  keyword: z.string().trim().min(1, '请输入公众号名称或文章链接'),
});
export type AccountLookupInput = z.infer<typeof accountLookupSchema>;

export const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  biz: z.string().trim().min(1).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')).transform((v) => (v ? v : undefined)),
  intro: z.string().trim().optional(),
  providerType: z.enum([PROVIDER_TYPE.manual, PROVIDER_TYPE.rss, PROVIDER_TYPE.rsshub]),
  providerConfig: z.record(z.unknown()).optional(),
  sinceDays: z.number().int().min(1).max(365).optional(),
  initialFetch: z.boolean().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum([ACCOUNT_STATUS.active, ACCOUNT_STATUS.paused, ACCOUNT_STATUS.error]).optional(),
  providerType: z.enum([PROVIDER_TYPE.manual, PROVIDER_TYPE.rss, PROVIDER_TYPE.rsshub]).optional(),
  providerConfig: z.record(z.unknown()).optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const fetchTriggerSchema = z.object({
  // 来自 query string，必须 coerce，否则 "7" 会被判为非法
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type FetchTriggerInput = z.infer<typeof fetchTriggerSchema>;

export const importArticleSchema = z.object({
  url: z.string().url('请输入合法的文章链接'),
  accountId: z.string().optional(),
});
export type ImportArticleInput = z.infer<typeof importArticleSchema>;

export const summaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const summaryRunSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional(),
});
export type SummaryRunInput = z.infer<typeof summaryRunSchema>;

export const recipientCreateSchema = z.object({
  email: z.string().email('请输入合法的邮箱地址'),
  name: z.string().trim().optional(),
});
export type RecipientCreateInput = z.infer<typeof recipientCreateSchema>;

export const testMailSchema = z.object({
  to: z.string().email().optional(),
});

export const digestSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
  maxArticles: z.number().int().min(1).max(50).default(20),
  includeDigest: z.boolean().default(true),
});

export const llmSettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.3),
  maxInputCharsPerArticle: z.number().int().min(500).max(50000).default(8000),
});

export const smtpSettingsSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  from: z.string().optional(),
});

export const fetchSettingsSchema = z.object({
  lookbackDays: z.number().int().min(1).max(365).default(3),
  dailyLimitPerAccount: z.number().int().min(1).max(500).default(50),
  requestDelayMs: z.number().int().min(0).max(60000).default(3000),
  searchEndpoint: z.string().optional(),
  rsshubBaseUrl: z.string().optional(),
});

export const settingsUpdateSchema = z.object({
  llm: llmSettingsSchema.partial().optional(),
  smtp: smtpSettingsSchema.partial().optional(),
  digest: digestSettingsSchema.partial().optional(),
  fetch: fetchSettingsSchema.partial().optional(),
});
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

export const jobLogQuerySchema = paginationSchema.extend({
  type: z.string().optional(),
  status: z.string().optional(),
});
