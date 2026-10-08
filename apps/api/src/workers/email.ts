import { randomUUID } from 'node:crypto';
import { DelayedError, type Job } from 'bullmq';
import { db, logger, redis } from '../config/clients';
import { env } from '../config/env';
import { claimEmail, finalizeEmail, indexEvent } from '../repositories/emails';
import { acquireGate, releaseGate } from '../services/rate-gate';
import { sendEmail } from '../integrations/email';

async function defer(job: Job, token: string | undefined, id: string, at: number) {
  await db.$transaction(async (tx) => {
    await tx.email.update({
      where: { id },
      data: { nextAttemptAt: new Date(at), revision: { increment: 1 } },
    });
    await indexEvent(tx, id);
  });
  await job.moveToDelayed(at, token);
  throw new DelayedError();
}
export async function processEmail(job: Job<{ emailId: string }>, token?: string) {
  const email = await db.email.findUnique({
    where: { id: job.data.emailId },
    include: { sender: true, campaign: true },
  });
  if (!email || email.status === 'SENT' || email.status === 'FAILED') return;
  if (email.status === 'PROCESSING') {
    // A stalled/retried job crossed the claim boundary. Never risk a second SMTP send.
    await finalizeEmail(email.id, email.claimToken!, {
      status: 'FAILED',
      errorMessage:
        'Delivery outcome unknown after worker interruption. Check the Ethereal inbox before sending a new campaign.',
    });
    return;
  }
  if (email.nextAttemptAt.getTime() > Date.now())
    return defer(job, token, email.id, email.nextAttemptAt.getTime());
  // Strict campaign sequence, best-effort fairness between different campaigns.
  const predecessor = await db.email.findFirst({
    where: {
      campaignId: email.campaignId,
      sequenceNumber: { lt: email.sequenceNumber },
      status: { in: ['SCHEDULED', 'PROCESSING'] },
    },
    orderBy: { sequenceNumber: 'asc' },
  });
  const delay = Math.max(
    env.MIN_EMAIL_DELAY_MS,
    email.sender.minDelayMs,
    email.campaign.delayBetweenEmails,
  );
  if (predecessor)
    return defer(
      job,
      token,
      email.id,
      Math.max(
        Date.now() + Math.max(delay, 1000),
        predecessor.nextAttemptAt.getTime() + Math.max(delay, 1000),
      ),
    );
  const claimToken = randomUUID();
  const senderLimit = Math.min(env.MAX_EMAILS_PER_HOUR, email.sender.maxEmailsPerHour);
  const gate = await acquireGate(
    email.senderId,
    email.campaignId,
    senderLimit,
    email.campaign.hourlyLimit,
    delay,
    claimToken,
  );
  const campaignAtLimit = gate.campaignCount >= email.campaign.hourlyLimit;
  if (gate.limited || (gate.allowed && (gate.count >= senderLimit || campaignAtLimit))) {
    await db.outbox.create({
      data: {
        kind: 'ALERT',
        entityId: email.senderId,
        payload: {
          window: gate.window,
          limit: campaignAtLimit ? email.campaign.hourlyLimit : senderLimit,
        },
      },
    });
  }
  if (!gate.allowed) return defer(job, token, email.id, gate.nextAt + email.sequenceNumber);
  try {
    const claimed = await claimEmail(email.id, claimToken);
    if (!claimed.count) return;
    if ((await redis.get(`gate:{${email.senderId}}:lease`)) !== claimToken)
      throw new Error('Sender lease expired before delivery');
    logger.info(
      {
        email_id: email.id,
        sender_id: email.senderId,
        recipient: email.recipient,
        sequence_number: email.sequenceNumber,
        previous_status: email.status,
        current_status: 'PROCESSING',
        scheduled_at: email.scheduledAt,
        rate_limit_window: gate.window,
        worker_id: process.pid,
      },
      'Email claimed',
    );
    let delivery;
    try {
      delivery = await sendEmail(email, email.sender);
    } catch {
      await finalizeEmail(email.id, claimToken, {
        status: 'FAILED',
        errorMessage:
          'SMTP delivery failed or timed out. Check Ethereal credentials and inbox before resubmitting.',
      });
      logger.warn({ email_id: email.id, current_status: 'FAILED' }, 'SMTP attempt failed');
      return;
    }
    // DB failures after SMTP acceptance must propagate, never be mistaken for an SMTP failure.
    await finalizeEmail(email.id, claimToken, { status: 'SENT', sentAt: new Date(), ...delivery });
    logger.info(
      {
        email_id: email.id,
        current_status: 'SENT',
        actual_send_time: new Date(),
        previewUrl: delivery.previewUrl,
      },
      'Email sent',
    );
  } finally {
    await releaseGate(email.senderId, claimToken, delay);
  }
}
