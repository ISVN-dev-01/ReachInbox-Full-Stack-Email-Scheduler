import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Profile,
  SenderView,
  EmailView,
  Page,
  SlackView,
  CampaignInput,
} from '@reachinbox/shared';
import { ApiError, get, post, request } from '../api/client';
export function useCurrentUser() {
  return useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        return await get<Profile>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60000,
  });
}
export const useSenders = () =>
  useQuery({ queryKey: ['senders'], queryFn: () => get<SenderView[]>('/senders') });
export const useConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: () =>
      get<{
        maxUploadBytes: number;
        maxRecipients: number;
        minDelayMs: number;
        maxEmailsPerHour: number;
      }>('/config'),
  });
export const useStats = () =>
  useQuery({
    queryKey: ['stats'],
    queryFn: () => get<{ scheduled: number; sent: number; failed: number }>('/dashboard/stats'),
  });
export const useSlackStatus = () =>
  useQuery({ queryKey: ['slack'], queryFn: () => get<SlackView | null>('/slack/status') });
export const useEmail = (id: string) =>
  useQuery({
    queryKey: ['email', id],
    queryFn: () => get<EmailView & { sender: SenderView }>(`/emails/${id}`),
  });
export function useEmails(kind: string, page: number, search: string, campaignId = '') {
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (search || campaignId) {
    params.set('q', search);
    params.set('status', kind === 'scheduled' ? 'SCHEDULED,PROCESSING' : kind.toUpperCase());
    if (campaignId) params.set('campaignId', campaignId);
  }
  return useQuery({
    queryKey: ['emails', kind, page, search, campaignId],
    queryFn: () =>
      request<Page<EmailView>>(`/emails/${search || campaignId ? 'search' : kind}?${params}`),
  });
}
export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: CampaignInput; key: string }) =>
      post<{ id: string; totalRecipients: number }>('/campaigns', input, {
        'Idempotency-Key': key,
      }),
    onSuccess: () => client.invalidateQueries(),
  });
}
