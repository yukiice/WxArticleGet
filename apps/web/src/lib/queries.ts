'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateAccountInput,
  CreateUserInput,
  SettingsUpdateInput,
  UpdateAccountInput,
  UpdateUserInput,
} from '@wx/shared';
import { endpoints, type ArticleQueryParams } from './api';

export const queryKeys = {
  articles: (params: ArticleQueryParams) => ['articles', params] as const,
  article: (id: string) => ['article', id] as const,
  accounts: ['accounts'] as const,
  catalog: ['catalog'] as const,
  summaries: (date?: string) => ['summaries', date ?? 'today'] as const,
  recipients: ['recipients'] as const,
  settings: ['settings'] as const,
  jobLogs: (params: Record<string, unknown>) => ['jobLogs', params] as const,
  sendLogs: (page: number) => ['sendLogs', page] as const,
  stats: ['stats'] as const,
  users: ['users'] as const,
  me: ['me'] as const,
};

export function useArticles(params: ArticleQueryParams) {
  return useQuery({
    queryKey: queryKeys.articles(params),
    queryFn: () => endpoints.articles(params),
    placeholderData: (previous) => previous,
  });
}

export function useArticle(id: string) {
  return useQuery({
    queryKey: queryKeys.article(id),
    queryFn: () => endpoints.article(id),
    enabled: Boolean(id),
  });
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) => endpoints.markRead(id, isRead),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['articles'] });
      void client.invalidateQueries({ queryKey: ['article'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: endpoints.accounts });
}

export function useCatalogStatus() {
  return useQuery({ queryKey: queryKeys.catalog, queryFn: endpoints.catalogStatus });
}

export function useSyncCatalog() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.syncCatalog(),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.catalog }),
  });
}

export function useLookupAccount() {
  return useMutation({ mutationFn: (keyword: string) => endpoints.lookupAccount(keyword) });
}

export function useCreateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountInput) => endpoints.createAccount(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useUpdateAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAccountInput }) => endpoints.updateAccount(id, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endpoints.deleteAccount(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export function useFetchAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sinceDays }: { id: string; sinceDays?: number }) => endpoints.fetchAccount(id, sinceDays),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.jobLogs({}) });
      void client.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useImportArticle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => endpoints.importArticle(url),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['articles'] });
      void client.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useSummaries(date?: string) {
  return useQuery({
    queryKey: queryKeys.summaries(date),
    queryFn: () => endpoints.summaries(date),
  });
}

export function useRunSummary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ date, force }: { date?: string; force?: boolean }) => endpoints.runSummary(date, force),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['summaries'] }),
  });
}

export function useRecipients() {
  return useQuery({ queryKey: queryKeys.recipients, queryFn: endpoints.recipients });
}

export function useAddRecipient() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ email, name }: { email: string; name?: string }) => endpoints.addRecipient(email, name),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.recipients }),
  });
}

export function useDeleteRecipient() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endpoints.deleteRecipient(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.recipients }),
  });
}

export function useTestMail() {
  return useMutation({ mutationFn: (to?: string) => endpoints.sendTestMail(to) });
}

export function useSendDigestNow() {
  return useMutation({ mutationFn: (date?: string) => endpoints.sendDigestNow(date) });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: endpoints.settings });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdateInput) => endpoints.updateSettings(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}

export function useJobLogs(params: { page?: number; type?: string; status?: string }) {
  return useQuery({
    queryKey: queryKeys.jobLogs(params),
    queryFn: () => endpoints.jobLogs(params),
    refetchInterval: 15_000,
  });
}

export function useSendLogs(page: number) {
  return useQuery({ queryKey: queryKeys.sendLogs(page), queryFn: () => endpoints.sendLogs({ page }) });
}

export function useStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: endpoints.stats, refetchInterval: 30_000 });
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: endpoints.me });
}

export function useUsers() {
  return useQuery({ queryKey: queryKeys.users, queryFn: endpoints.users });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserInput) => endpoints.createUser(body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserInput }) => endpoints.updateUser(id, body),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useDeleteUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endpoints.deleteUser(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      endpoints.changePassword(body),
  });
}


