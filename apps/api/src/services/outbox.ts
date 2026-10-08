import { Client } from 'pg';
import { db, logger } from '../config/clients';
import { env } from '../config/env';
import { sendQueue, indexQueue, alertQueue } from '../queues';
import { emailJobId } from '../queues/identity';
import { z } from 'zod';

export async function drainOutbox() {
  // Row locks + SKIP LOCKED permit concurrent dispatchers; stable job IDs absorb replays.
  for (;;) {
    const processed = await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: bigint; kind: string; entityId: string; payload: unknown }>
        >`SELECT * FROM "Outbox" ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const event of rows) {
          if (event.kind === 'SEND') {
            const email = await tx.email.findUnique({ where: { id: event.entityId } });
            if (email?.status === 'SCHEDULED')
              await sendQueue.add(
                'send',
                { emailId: email.id },
                {
                  jobId: emailJobId(email.id),
                  delay: Math.max(0, email.nextAttemptAt.getTime() - Date.now()),
                  attempts: 8,
                  backoff: { type: 'exponential', delay: 1000 },
                  removeOnComplete: { age: 604800 },
                  removeOnFail: false,
                },
              );
          } else if (event.kind === 'INDEX') {
            await indexQueue.add(
              'index',
              { emailId: event.entityId },
              {
                jobId: `index-${event.id}`,
                attempts: 20,
                backoff: { type: 'exponential', delay: 1000 },
                removeOnComplete: { age: 86400 },
                removeOnFail: false,
              },
            );
          } else {
            const payload = z
              .object({ window: z.number(), limit: z.number() })
              .parse(event.payload);
            await alertQueue.add(
              'notify',
              { senderId: event.entityId, ...payload },
              {
                jobId: `alert-${event.entityId}-${payload.window}`,
                attempts: 8,
                backoff: { type: 'exponential', delay: 5000 },
                // Disconnected alerts must not suppress new events if Slack is connected later.
                // Successful notifications have their own Redis sender/window sent marker.
                removeOnComplete: true,
                removeOnFail: false,
              },
            );
          }
          await tx.outbox.delete({ where: { id: event.id } });
        }
        return rows.length;
      },
      { timeout: 60000 },
    );
    if (processed === 0) return;
  }
}

export async function startOutbox(onFatal: (error: unknown) => void) {
  const listener = new Client({ connectionString: env.DATABASE_URL });
  let running = false;
  let requested = false;
  let closed = false;
  const wake = async () => {
    requested = true;
    if (running || closed) return;
    running = true;
    try {
      do {
        requested = false;
        await drainOutbox();
      } while (requested && !closed);
    } catch (error) {
      logger.error('Outbox dispatch failed; restart worker to resume durable events');
      onFatal(error);
    } finally {
      running = false;
    }
  };
  listener.on('notification', () => {
    void wake();
  });
  listener.on('error', onFatal);
  await listener.connect();
  await listener.query('LISTEN outbox_ready');
  // LISTEN before draining closes the startup race. Only undelivered outbox events are recovered.
  await wake();
  return async () => {
    closed = true;
    await listener.end();
  };
}
