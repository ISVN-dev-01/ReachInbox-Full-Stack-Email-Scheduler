import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  sender: vi.fn(),
  count: vi.fn(),
  exists: vi.fn(),
  set: vi.fn(),
}));
vi.mock('../apps/api/src/config/clients', () => ({
  db: { sender: { findUnique: mocks.sender }, email: { count: mocks.count } },
  redis: { exists: mocks.exists, set: mocks.set },
  logger: { info: vi.fn() },
}));
vi.mock('../apps/api/src/utils/crypto', () => ({ decrypt: () => 'test-token' }));
import { notifyRateLimit } from '../apps/api/src/integrations/slack';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  mocks.count.mockResolvedValue(143);
  mocks.exists.mockResolvedValue(0);
});
it('does nothing when Slack is disconnected', async () => {
  mocks.sender.mockResolvedValue({ user: { slack: null } });
  await notifyRateLimit('s', 1, 200);
  expect(fetch).not.toHaveBeenCalled();
});
it('posts a live API request when connected and deduplicates confirmed alerts', async () => {
  mocks.sender.mockResolvedValue({
    email: 'sales@example.com',
    user: { slack: { accessToken: 'encrypted', channelId: 'C1' } },
  });
  await notifyRateLimit('s', 1, 200);
  expect(fetch).toHaveBeenCalledWith(
    'https://slack.com/api/chat.postMessage',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(mocks.set).toHaveBeenCalled();
  mocks.exists.mockResolvedValue(1);
  await notifyRateLimit('s', 1, 200);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('leaves unsuccessful notifications retryable', async () => {
  mocks.sender.mockResolvedValue({
    email: 'a@example.com',
    user: { slack: { accessToken: 'encrypted', channelId: 'C1' } },
  });
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: false, error: 'not_in_channel' }),
  } as Response);
  await expect(notifyRateLimit('s', 1, 200)).rejects.toThrow('not_in_channel');
  expect(mocks.set).not.toHaveBeenCalled();
});
