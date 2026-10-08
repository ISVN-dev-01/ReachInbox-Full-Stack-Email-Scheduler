import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { db, redis, elastic } from '../../apps/api/src/config/clients';
import { env } from '../../apps/api/src/config/env';
import { gateScript, releaseScript } from '../../apps/api/src/services/rate-gate';
import { claimEmail } from '../../apps/api/src/repositories/emails';
import {
  ensureIndex,
  indexEmail,
  searchEmails,
} from '../../apps/api/src/integrations/elasticsearch';
import { emailJobId } from '../../apps/api/src/queues/identity';
import { createCampaign } from '../../apps/api/src/services/campaigns';
import { encrypt } from '../../apps/api/src/utils/crypto';
const runId = randomUUID();
let userId: string;
let senderId: string;
let emailId: string;
const connections: Redis[] = [];
beforeAll(async () => {
  if (
    !env.DATABASE_URL.includes('reachinbox_test') ||
    !env.REDIS_URL.endsWith('/15') ||
    env.ELASTICSEARCH_INDEX !== 'reachinbox-test-emails'
  )
    throw new Error(
      'Integration tests require the dedicated test database, Redis DB 15 and test index.',
    );
  await db.$connect();
  await redis.connect();
  await redis.ping();
  await ensureIndex();
  const user = await db.user.create({
    data: { googleId: runId, email: `${runId}@example.com`, name: 'Integration test' },
  });
  userId = user.id;
  const sender = await db.sender.create({
    data: {
      userId,
      name: 'Test',
      email: user.email,
      minDelayMs: 2000,
      maxEmailsPerHour: 200,
      etherealPassword: encrypt('test-credential-not-used-for-smtp'),
    },
  });
  senderId = sender.id;
});
afterAll(async () => {
  if (userId) {
    const emails = await db.email.findMany({ where: { userId }, select: { id: true } });
    await db.outbox.deleteMany({
      where: { entityId: { in: [...emails.map((email) => email.id), senderId] } },
    });
    await elastic.deleteByQuery({
      index: env.ELASTICSEARCH_INDEX,
      query: { term: { userId } },
      refresh: true,
    });
    await db.email.deleteMany({ where: { userId } });
    await db.emailCampaign.deleteMany({ where: { userId } });
    await db.sender.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await Promise.all(connections.map((client) => client.quit()));
  await redis.quit();
  await db.$disconnect();
  await elastic.close();
});
describe('real infrastructure', () => {
  it('persists campaign emails and outbox events atomically, including retry deduplication', async () => {
    const input = {
      senderId,
      subject: `Needle ${runId}`,
      body: 'Infrastructure validation',
      recipients: ['first@example.com', 'second@example.com'],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delayBetweenEmails: 2000,
      hourlyLimit: 200,
    };
    const key = randomUUID();
    const [first, second] = await Promise.all([
      createCampaign(userId, input, key),
      createCampaign(userId, input, key),
    ]);
    expect(first.id).toBe(second.id);
    const emails = await db.email.findMany({
      where: { campaignId: first.id },
      orderBy: { sequenceNumber: 'asc' },
    });
    expect(emails).toHaveLength(2);
    emailId = emails[0]!.id;
    expect(
      await db.outbox.count({ where: { entityId: { in: emails.map((email) => email.id) } } }),
    ).toBe(4);
  });
  it('allows only one of 30 simultaneous database claims', async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => claimEmail(emailId, randomUUID())),
    );
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
  });
  it('indexes and searches through Elasticsearch with tenant isolation and version fencing', async () => {
    await indexEmail(emailId);
    await elastic.indices.refresh({ index: env.ELASTICSEARCH_INDEX });
    expect(
      (await searchEmails(userId, 'Needle', '', undefined, 1, 25)).data.map((email) => email.id),
    ).toContain(emailId);
    expect((await searchEmails(randomUUID(), 'Needle', '', undefined, 1, 25)).data).toHaveLength(0);
    await db.email.update({
      where: { id: emailId },
      data: { status: 'SENT', sentAt: new Date(), revision: { increment: 1 } },
    });
    await indexEmail(emailId);
    await elastic.indices.refresh({ index: env.ELASTICSEARCH_INDEX });
    expect((await searchEmails(userId, 'Needle', 'SENT', undefined, 1, 25)).data[0]?.status).toBe(
      'SENT',
    );
  });
  it('enforces quota across independent Redis clients and rejects sends during the delay', async () => {
    const clients = Array.from({ length: 4 }, () => new Redis(env.REDIS_URL));
    connections.push(...clients);
    const prefix = `test-gate:{${runId}}`;
    const campaign = `${prefix}:campaign`;
    const permit = (client: Redis, token: string, delay = 0) =>
      client.eval(gateScript, 2, prefix, campaign, 3, 3, delay, token, 60000) as Promise<number[]>;
    const first = await Promise.all(
      clients.map((client, index) => permit(client, `claim-${index}`, 500)),
    );
    expect(first.filter((result) => result[0] === 1)).toHaveLength(1);
    const winner = first.findIndex((result) => result[0] === 1);
    await clients[0]!.eval(releaseScript, 1, prefix, `claim-${winner}`, 500);
    expect((await permit(clients[1]!, 'early'))[0]).toBe(0);
    // Advance only the test gate's nextAt value to exercise the quota without clock sleeps.
    await clients[0]!.del(`${prefix}:next`);
    for (let index = 0; index < 2; index++) {
      expect((await permit(clients[index]!, `more-${index}`))[0]).toBe(1);
      await clients[index]!.eval(releaseScript, 1, prefix, `more-${index}`, 0);
    }
    const overLimit = await Promise.all(clients.map((client) => permit(client, randomUUID())));
    expect(overLimit.every((result) => result[0] === 0 && result[3] === 1)).toBe(true);
    const window = Math.floor(Date.now() / 3600000);
    await redis.del(
      `${prefix}:next`,
      `${prefix}:lease`,
      `${prefix}:hour:${window}`,
      `${campaign}:hour:${window}`,
    );
  });
  it('keeps delayed job identity across queue/worker connection restarts and executes once', async () => {
    const name = `restart-${runId}`;
    const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    connections.push(client);
    let queue = new Queue(name, { connection: client });
    const id = emailJobId(randomUUID());
    const at = Date.now() + 1500;
    await queue.add('send', { id }, { jobId: id, delay: at - Date.now() });
    await queue.add('send', { id }, { jobId: id, delay: at - Date.now() });
    expect(await queue.getDelayedCount()).toBe(1);
    await queue.close();
    queue = new Queue(name, { connection: client });
    const restored = await queue.getJob(id);
    expect(restored?.id).toBe(id);
    const events = new QueueEvents(name, { connection: client });
    await events.waitUntilReady();
    let executions = 0;
    const worker = new Worker(
      name,
      async () => {
        executions++;
        expect(Date.now()).toBeGreaterThanOrEqual(at - 25);
      },
      { connection: client },
    );
    await restored!.waitUntilFinished(events, 10000);
    expect(executions).toBe(1);
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });
});
