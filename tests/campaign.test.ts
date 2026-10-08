import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  existing: vi.fn(),
  sender: vi.fn(),
  campaign: vi.fn(),
  emails: vi.fn(),
  outbox: vi.fn(),
}));
vi.mock('../apps/api/src/config/clients', () => ({
  db: {
    emailCampaign: { findUnique: mocks.existing },
    sender: { findFirst: mocks.sender },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        emailCampaign: { create: mocks.campaign },
        email: { createMany: mocks.emails },
        outbox: { createMany: mocks.outbox },
      }),
  },
}));
import { createCampaign } from '../apps/api/src/services/campaigns';
const input = () => ({
  senderId: '22222222-2222-4222-8222-222222222222',
  subject: 'Follow-up',
  body: 'Hello',
  recipients: ['a@example.com', 'A@example.com', 'b@example.com'],
  startTime: new Date(Date.now() + 60000).toISOString(),
  delayBetweenEmails: 1,
  hourlyLimit: 300,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.existing.mockResolvedValue(null);
  mocks.sender.mockResolvedValue({
    id: input().senderId,
    minDelayMs: 2000,
    maxEmailsPerHour: 200,
    etherealPassword: 'encrypted',
  });
  mocks.campaign.mockResolvedValue({ id: 'campaign', totalRecipients: 2 });
});
it('atomically persists deduplicated emails with durable dispatch and index events', async () => {
  await createCampaign('user', input(), 'key');
  const emails = mocks.emails.mock.calls[0]?.[0].data;
  expect(emails).toHaveLength(2);
  expect(emails[1].scheduledAt.getTime() - emails[0].scheduledAt.getTime()).toBe(2000);
  expect(emails[0].bullJobId).toBe(`email-${emails[0].id}`);
  expect(mocks.outbox.mock.calls[0]?.[0].data).toHaveLength(4);
  expect(mocks.campaign.mock.calls[0]?.[0].data.hourlyLimit).toBe(200);
});
it('rejects sender accounts from another tenant', async () => {
  mocks.sender.mockResolvedValue(null);
  await expect(createCampaign('user', input(), 'key')).rejects.toMatchObject({ status: 404 });
  expect(mocks.campaign).not.toHaveBeenCalled();
});
it('rejects past schedules and does not create rows', async () => {
  await expect(
    createCampaign('user', { ...input(), startTime: '2020-01-01T00:00:00Z' }, 'key'),
  ).rejects.toMatchObject({ code: 'INVALID_START_TIME' });
  expect(mocks.emails).not.toHaveBeenCalled();
});
it('rejects reuse of an idempotency key for a different request', async () => {
  mocks.existing.mockResolvedValue({ requestHash: 'other-content' });
  await expect(createCampaign('user', input(), 'key')).rejects.toMatchObject({ status: 409 });
});
