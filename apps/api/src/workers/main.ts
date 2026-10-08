import { Worker } from 'bullmq';
import { db, redis, logger } from '../config/clients';
import { env } from '../config/env';
import { processEmail } from './email';
import { ensureIndex, indexEmail } from '../integrations/elasticsearch';
import { notifyRateLimit } from '../integrations/slack';
import { startOutbox } from '../services/outbox';
import { closeTransports } from '../integrations/email';
import { queues, sendQueue } from '../queues';
import { indexEvent } from '../repositories/emails';

async function main() {
  await db.$connect();
  if (redis.status === 'wait') await redis.connect();
  // Repair terminal state if the process died before its failed-event handler committed.
  for (let offset = 0; ; offset += 100) {
    const failed = await sendQueue.getFailed(offset, offset + 99);
    for (const job of failed) {
      await db.$transaction(async (tx) => {
        const updated = await tx.email.updateMany({
          where: { id: job.data.emailId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
          data: {
            status: 'FAILED',
            errorMessage:
              'The queue exhausted delivery attempts. Check Ethereal before resubmitting.',
            revision: { increment: 1 },
          },
        });
        if (updated.count) await indexEvent(tx, job.data.emailId);
      });
    }
    if (failed.length < 100) break;
  }
  const workers = [
    new Worker('email-send', processEmail, {
      connection: redis,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: env.SENDER_LEASE_MS,
      maxStalledCount: 1,
    }),
    new Worker<{ emailId: string }>(
      'email-index',
      async (job) => {
        await ensureIndex();
        await indexEmail(job.data.emailId);
      },
      { connection: redis, concurrency: env.INDEX_WORKER_CONCURRENCY },
    ),
    new Worker<{ senderId: string; window: number; limit: number }>(
      'slack-alert',
      (job) => notifyRateLimit(job.data.senderId, job.data.window, job.data.limit),
      { connection: redis, concurrency: env.SLACK_WORKER_CONCURRENCY },
    ),
  ];
  for (const worker of workers) {
    worker.on('error', (error) =>
      logger.error({ message: error.message, queue: worker.name }, 'Worker error'),
    );
    worker.on('failed', (job, error) => {
      logger.error(
        { jobId: job?.id, queue: worker.name, error: error.name, attempts: job?.attemptsMade },
        'Job failed',
      );
      if (
        worker.name === 'email-send' &&
        job &&
        'emailId' in job.data &&
        (job.attemptsMade >= (job.opts.attempts ?? 1) ||
          error.message.includes('stalled more than allowable'))
      ) {
        const emailId = job.data.emailId;
        void db
          .$transaction(async (tx) => {
            const updated = await tx.email.updateMany({
              where: { id: emailId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
              data: {
                status: 'FAILED',
                errorMessage:
                  'Delivery infrastructure exhausted retries. Inspect the queue and Ethereal inbox.',
                revision: { increment: 1 },
              },
            });
            if (updated.count) await indexEvent(tx, emailId);
          })
          .catch(() =>
            logger.error('Could not persist terminal worker failure; inspect failed queue'),
          );
      }
    });
  }
  let stopping = false;
  let stopOutbox: () => Promise<void> = async () => {};
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    if (code !== 0) {
      // Do not wait forever for Redis-backed close operations during an infrastructure outage.
      // Durable jobs/outbox rows are recovered by the supervisor's next worker process.
      logger.fatal('Dispatcher unavailable; exiting for supervised recovery');
      process.exit(code);
    }
    await stopOutbox();
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(queues.map((queue) => queue.close()));
    closeTransports();
    await redis.quit();
    await db.$disconnect();
    process.exit(code);
  };
  stopOutbox = await startOutbox(() => {
    void stop(1);
  });
  process.on('SIGINT', () => {
    void stop();
  });
  process.on('SIGTERM', () => {
    void stop();
  });
  logger.info({ concurrency: env.WORKER_CONCURRENCY, worker_id: process.pid }, 'Workers ready');
}
main().catch((error) => {
  logger.fatal(
    { error: error instanceof Error ? error.message : 'Unknown' },
    'Worker startup failed',
  );
  process.exit(1);
});
