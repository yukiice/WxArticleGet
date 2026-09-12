import type {
  AccountCandidate,
  AccountDto,
  ArticleDetailDto,
  ArticleListItemDto,
  CreateAccountInput,
  CreateUserInput,
  EmailRecipientDto,
  JobLogDto,
  OverviewStatsDto,
  Paginated,
  SendLogDto,
  SettingsUpdateInput,
  SummaryDto,
  UpdateAccountInput,
  UpdateUserInput,
  UserDto,
} from '@wx/shared';

export interface SettingsView {
  llm: { apiKey: string; hasApiKey: boolean; baseUrl: string; model: string; temperature: number; maxInputCharsPerArticle: number };
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; pass: string; hasPass: boolean };
  digest: { enabled: boolean; sendTime: string; maxArticles: number; includeDigest: boolean };
  fetch: { lookbackDays: number; dailyLimitPerAccount: number; requestDelayMs: number; searchEndpoint?: string; rsshubBaseUrl?: string };
}

interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !payload || payload.code !== 0) {
    if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error(payload?.message ?? `请求失败（${response.status}）`);
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface ArticleQueryParams {
  date?: string;
  accountId?: string;
  q?: string;
  isRead?: 'true' | 'false';
  page?: number;
  pageSize?: number;
}

export const endpoints = {
  login: (body: { username: string; password: string }) =>
    api.post<{ username: string; role: string }>('/auth/login', body),
  logout: () => api.post<{ ok: boolean }>('/auth/logout'),
  me: () => api.get<{ sub: string; username: string; role: string }>('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ ok: boolean }>('/auth/password', body),
  users: () => api.get<UserDto[]>('/auth/users'),
  createUser: (body: CreateUserInput) => api.post<UserDto>('/auth/users', body),
  updateUser: (id: string, body: UpdateUserInput) => api.patch<UserDto>(`/auth/users/${id}`, body),
  deleteUser: (id: string) => api.del<{ ok: boolean }>(`/auth/users/${id}`),

  articles: (params: ArticleQueryParams) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    return api.get<Paginated<ArticleListItemDto>>(`/articles?${search.toString()}`);
  },
  article: (id: string) => api.get<ArticleDetailDto>(`/articles/${id}`),
  markRead: (id: string, isRead: boolean) => api.patch<{ ok: boolean }>(`/articles/${id}`, { isRead }),
  importArticle: (url: string) => api.post<{ accountId: string; queued: boolean }>('/articles/import', { url }),

  accounts: () => api.get<AccountDto[]>('/accounts'),
  catalogStatus: () => api.get<{ count: number; lastSyncedAt: string | null }>('/accounts/catalog'),
  syncCatalog: () => api.post<{ queued: boolean }>('/accounts/catalog/sync'),
  lookupAccount: (keyword: string) => api.post<AccountCandidate[]>('/accounts/lookup', { keyword }),
  createAccount: (body: CreateAccountInput) => api.post<AccountDto>('/accounts', body),
  updateAccount: (id: string, body: UpdateAccountInput) => api.patch<AccountDto>(`/accounts/${id}`, body),
  deleteAccount: (id: string) => api.del<{ ok: boolean }>(`/accounts/${id}`),
  fetchAccount: (id: string, sinceDays?: number) =>
    api.post<{ queued: boolean }>(`/accounts/${id}/fetch${sinceDays ? `?sinceDays=${sinceDays}` : ''}`),

  summaries: (date?: string) =>
    api.get<{ date: string; summary: SummaryDto | null; recent: SummaryDto[] }>(
      `/summaries${date ? `?date=${date}` : ''}`,
    ),
  runSummary: (date?: string, force = false) =>
    api.post<{ queued: boolean; date: string }>('/summaries/run', { date, force }),

  recipients: () => api.get<EmailRecipientDto[]>('/email/recipients'),
  addRecipient: (email: string, name?: string) =>
    api.post<EmailRecipientDto>('/email/recipients', { email, name }),
  deleteRecipient: (id: string) => api.del<{ ok: boolean }>(`/email/recipients/${id}`),
  sendTestMail: (to?: string) => api.post<{ sent: boolean; to: string[] }>('/email/test', { to }),
  sendDigestNow: (date?: string) =>
    api.post<{ queued: boolean }>(`/email/send${date ? `?date=${date}` : ''}`),

  settings: () => api.get<SettingsView>('/settings'),
  updateSettings: (body: SettingsUpdateInput) => api.put<SettingsView>('/settings', body),

  jobLogs: (params: { page?: number; pageSize?: number; type?: string; status?: string }) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    return api.get<Paginated<JobLogDto>>(`/logs/jobs?${search.toString()}`);
  },
  sendLogs: (params: { page?: number; pageSize?: number }) =>
    api.get<Paginated<SendLogDto>>(`/email/logs?page=${params.page ?? 1}&pageSize=${params.pageSize ?? 20}`),
  stats: () => api.get<OverviewStatsDto>('/stats/overview'),
};
