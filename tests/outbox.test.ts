import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  email: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
  index: vi.fn(),
  alert: vi.fn(),
}));
vi.mock('../apps/api/src/config/clients', () => ({
  db: {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $queryRaw: mocks.rows,
        email: { findUnique: mocks.email },
        outbox: { delete: mocks.remove },
      }),
  },
  logger: { error: vi.fn() },
}));
vi.mock('../apps/api/src/queues', () => ({
  sendQueue: { add: mocks.send },
  indexQueue: { add: mocks.index },
  alertQueue: { add: mocks.alert },
}));
import { drainOutbox } from '../apps/api/src/services/outbox';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows
    .mockResolvedValueOnce([{ id: 1n, kind: 'SEND', entityId: 'email', payload: {} }])
    .mockResolvedValue([]);
  mocks.email.mockResolvedValue({
    id: 'email',
    status: 'SCHEDULED',
    nextAttemptAt: new Date(Date.now() + 60000),
  });
});
it('creates a persistent delayed job and then acknowledges its outbox row', async () => {
  await drainOutbox();
  expect(mocks.send).toHaveBeenCalledWith(
    'send',
    { emailId: 'email' },
    expect.objectContaining({
      jobId: 'email-email',
      delay: expect.any(Number),
      removeOnFail: false,
    }),
  );
  expect(mocks.send.mock.calls[0]?.[2].delay).toBeGreaterThan(50000);
  expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 1n } });
});
it('leaves the durable event unacknowledged when Redis fails', async () => {
  mocks.send.mockRejectedValue(new Error('Redis unavailable'));
  await expect(drainOutbox()).rejects.toThrow('Redis unavailable');
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('never reconstructs a send for a completed email', async () => {
  mocks.email.mockResolvedValue({ id: 'email', status: 'SENT' });
  await drainOutbox();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalled();
});
it('allows future rate events to use a Slack connection made later in the same hour', async () => {
  mocks.rows
    .mockReset()
    .mockResolvedValueOnce([
      { id: 2n, kind: 'ALERT', entityId: 'sender', payload: { window: 123, limit: 2 } },
    ])
    .mockResolvedValue([]);
  await drainOutbox();
  expect(mocks.alert).toHaveBeenCalledWith(
    'notify',
    { senderId: 'sender', window: 123, limit: 2 },
    expect.objectContaining({ jobId: 'alert-sender-123', removeOnComplete: true }),
  );
});
