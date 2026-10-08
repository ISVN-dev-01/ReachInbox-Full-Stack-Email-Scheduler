import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { campaignSchema } from '../../../../packages/shared/src';
import { db } from '../config/clients';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { emailJobId } from '../queues/identity';

export async function createCampaign(userId: string, raw: unknown, requestKey: string) {
  const input = campaignSchema.parse(raw);
  input.recipients = [...new Set(input.recipients)];
  if (input.recipients.length > env.MAX_RECIPIENTS)
    throw new AppError(400, 'TOO_MANY_RECIPIENTS', `Limit: ${env.MAX_RECIPIENTS} recipients.`);
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const existing = await db.emailCampaign.findUnique({
    where: { userId_requestKey: { userId, requestKey } },
  });
  if (existing) {
    if (existing.requestHash !== requestHash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This submission key was already used for different content.',
      );
    return existing;
  }
  const startTime = new Date(input.startTime);
  if (startTime.getTime() < Date.now() - 60000 || startTime.getTime() > Date.now() + 366 * 86400000)
    throw new AppError(400, 'INVALID_START_TIME', 'Choose a start time within the next year.');
  const sender = await db.sender.findFirst({ where: { id: input.senderId, userId } });
  if (!sender) throw new AppError(404, 'SENDER_NOT_FOUND', 'Choose one of your sender accounts.');
  if (!sender.etherealPassword && (!env.ETHEREAL_PASSWORD || !env.ETHEREAL_USER))
    throw new AppError(
      503,
      'SMTP_NOT_CONFIGURED',
      'Configure an Ethereal account before scheduling.',
    );
  const delay = Math.max(input.delayBetweenEmails, sender.minDelayMs, env.MIN_EMAIL_DELAY_MS);
  const hourlyLimit = Math.min(input.hourlyLimit, sender.maxEmailsPerHour, env.MAX_EMAILS_PER_HOUR);
  try {
    return await db.$transaction(
      async (tx) => {
        const campaign = await tx.emailCampaign.create({
          data: {
            userId,
            senderId: sender.id,
            subject: input.subject,
            body: input.body,
            startTime,
            delayBetweenEmails: delay,
            hourlyLimit,
            totalRecipients: input.recipients.length,
            requestKey,
            requestHash,
          },
        });
        // Bounded batches avoid large SQL parameter lists; SMTP never runs in this request.
        for (let offset = 0; offset < input.recipients.length; offset += 500) {
          const emails = input.recipients.slice(offset, offset + 500).map((recipient, index) => {
            const id = randomUUID();
            const sequenceNumber = offset + index;
            const scheduledAt = new Date(startTime.getTime() + sequenceNumber * delay);
            return {
              id,
              campaignId: campaign.id,
              userId,
              senderId: sender.id,
              recipient,
              subject: input.subject,
              body: input.body,
              sequenceNumber,
              scheduledAt,
              nextAttemptAt: scheduledAt,
              bullJobId: emailJobId(id),
            };
          });
          await tx.email.createMany({ data: emails });
          await tx.outbox.createMany({
            data: emails.flatMap((email) => [
              { kind: 'SEND' as const, entityId: email.id },
              { kind: 'INDEX' as const, entityId: email.id },
            ]),
          });
        }
        return campaign;
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return createCampaign(userId, raw, requestKey);
    throw error;
  }
}
