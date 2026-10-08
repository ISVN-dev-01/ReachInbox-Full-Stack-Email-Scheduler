import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import session from 'express-session';
import supertest from 'supertest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), campaign: vi.fn() }));
vi.mock('../apps/api/src/config/clients', async () => {
  const { default: pino } = await import('pino');
  return {
    db: {
      email: { findMany: mocks.list, count: mocks.count },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    },
    redis: { eval: async () => 1 },
    elastic: {},
    logger: pino({ level: 'silent' }),
  };
});
vi.mock('../apps/api/src/queues', () => ({ queues: [] }));
vi.mock('../apps/api/src/services/campaigns', () => ({ createCampaign: mocks.campaign }));
import { createApp } from '../apps/api/src/app';
import { env } from '../apps/api/src/config/env';
const store = new session.MemoryStore();
const app = createApp(store);
function signedCookie(id: string) {
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(id)
    .digest('base64')
    .replace(/=+$/, '');
  return `reachinbox.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
}
const cookie = signedCookie('test-auth-session');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.count.mockResolvedValue(62);
  store.set('test-auth-session', {
    cookie: {
      originalMaxAge: 60000,
      expires: new Date(Date.now() + 60000),
      httpOnly: true,
      path: '/',
    },
    userId: 'user-1',
  });
});
describe('HTTP security and pagination', () => {
  it('rejects unauthenticated requests and protects Bull Board', async () => {
    expect((await supertest(app).get('/api/emails/scheduled')).status).toBe(401);
    expect((await supertest(app).get('/admin/queues')).status).toBe(401);
  });
  it('returns tenant-scoped pagination', async () => {
    const response = await supertest(app)
      .get('/api/emails/scheduled?page=2&limit=25')
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 2, limit: 25, total: 62, totalPages: 3 });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: { in: ['SCHEDULED', 'PROCESSING'] } },
        skip: 25,
        take: 25,
      }),
    );
  });
  it('returns structured validation errors', async () => {
    const response = await supertest(app).get('/api/emails/sent?page=0').set('Cookie', cookie);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('requires same-origin mutations', async () => {
    const response = await supertest(app)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .set('Origin', 'https://attacker.example')
      .send({});
    expect(response.status).toBe(403);
    expect(mocks.campaign).not.toHaveBeenCalled();
  });
  it('forwards an authenticated campaign request with idempotency protection', async () => {
    const key = '11111111-1111-4111-8111-111111111111';
    mocks.campaign.mockResolvedValue({ id: 'campaign', totalRecipients: 3 });
    const response = await supertest(app)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .set('Origin', env.FRONTEND_URL)
      .set('Idempotency-Key', key)
      .send({ subject: 'Hello' });
    expect(response.status).toBe(201);
    expect(mocks.campaign).toHaveBeenCalledWith('user-1', { subject: 'Hello' }, key);
  });
});
