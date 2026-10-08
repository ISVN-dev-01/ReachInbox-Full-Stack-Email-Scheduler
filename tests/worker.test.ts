import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelayedError, type Job } from 'bullmq';
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  outbox: vi.fn(),
  claim: vi.fn(),
  finalize: vi.fn(),
  index: vi.fn(),
  gate: vi.fn(),
  release: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../apps/api/src/config/clients', () => ({
  db: {
    email: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, update: mocks.update },
    outbox: { create: mocks.outbox },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ email: { update: mocks.update } }),
  },
  redis: { get: mocks.get },
  logger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../apps/api/src/repositories/emails', () => ({
  claimEmail: mocks.claim,
  finalizeEmail: mocks.finalize,
  indexEvent: mocks.index,
}));
vi.mock('../apps/api/src/services/rate-gate', () => ({
  acquireGate: mocks.gate,
  releaseGate: mocks.release,
}));
vi.mock('../apps/api/src/integrations/email', () => ({ sendEmail: mocks.send }));
import { processEmail } from '../apps/api/src/workers/email';
const base = {
  id: 'email',
  senderId: 'sender',
  campaignId: 'campaign',
  sequenceNumber: 0,
  status: 'SCHEDULED',
  scheduledAt: new Date(0),
  nextAttemptAt: new Date(0),
  sender: { minDelayMs: 2000, maxEmailsPerHour: 200 },
  campaign: { delayBetweenEmails: 2000, hourlyLimit: 200 },
};
const job = () =>
  ({ data: { emailId: 'email' }, moveToDelayed: vi.fn() }) as unknown as Job<{ emailId: string }>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue(base);
  mocks.findFirst.mockResolvedValue(null);
  mocks.gate.mockResolvedValue({ allowed: true, limited: false, count: 1, window: 123 });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.finalize.mockResolvedValue({ count: 1 });
  mocks.send.mockResolvedValue({ messageId: 'message', previewUrl: null });
  mocks.get.mockImplementation(async () => mocks.claim.mock.calls[0]?.[1]);
});
describe('worker delivery boundary', () => {
  it('never sends a completed email again', async () => {
    mocks.findUnique.mockResolvedValue({ ...base, status: 'SENT' });
    await processEmail(job(), 'lock');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('only the database claim winner attempts SMTP', async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    await processEmail(job(), 'lock');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });
  it('uses the same BullMQ job when rate limited', async () => {
    const current = job();
    mocks.gate.mockResolvedValue({
      allowed: false,
      limited: true,
      nextAt: Date.now() + 3600000,
      window: 123,
    });
    await expect(processEmail(current, 'lock')).rejects.toBeInstanceOf(DelayedError);
    expect(current.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'lock');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.outbox).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalled();
  });
  it('defers later sequence numbers until their predecessor finishes', async () => {
    mocks.findFirst.mockResolvedValue({ nextAttemptAt: new Date(Date.now() + 10000) });
    await expect(processEmail(job(), 'lock')).rejects.toBeInstanceOf(DelayedError);
    expect(mocks.gate).not.toHaveBeenCalled();
  });
  it('marks interrupted SMTP outcomes for review without sending again', async () => {
    mocks.findUnique.mockResolvedValue({ ...base, status: 'PROCESSING', claimToken: 'old' });
    await processEmail(job(), 'lock');
    expect(mocks.finalize).toHaveBeenCalledWith(
      'email',
      'old',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('persists SENT after acceptance', async () => {
    await processEmail(job(), 'lock');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledWith(
      'email',
      expect.any(String),
      expect.objectContaining({ status: 'SENT', messageId: 'message' }),
    );
  });
  it('contains individual SMTP errors and marks the email FAILED', async () => {
    mocks.send.mockRejectedValue(new Error('SMTP refused'));
    await processEmail(job(), 'lock');
    expect(mocks.finalize).toHaveBeenCalledWith(
      'email',
      expect.any(String),
      expect.objectContaining({ status: 'FAILED' }),
    );
  });
  it('does not label an accepted message as an SMTP failure when the DB goes down', async () => {
    mocks.finalize.mockRejectedValue(new Error('database unavailable'));
    await expect(processEmail(job(), 'lock')).rejects.toThrow('database unavailable');
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
    expect(mocks.finalize.mock.calls[0]?.[2]).toMatchObject({ status: 'SENT' });
  });
});
