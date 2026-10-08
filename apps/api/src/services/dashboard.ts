import { Prisma } from '@prisma/client';
import { db } from '../config/clients';
import { env } from '../config/env';
import { senderSchema } from '../../../../packages/shared/src';
import { senderSelect, paginated } from '../repositories/emails';
import { encrypt } from '../utils/crypto';
import { AppError } from '../utils/errors';
export async function stats(userId: string) {
  const [scheduled, sent, failed] = await db.$transaction([
    db.email.count({ where: { userId, status: { in: ['SCHEDULED', 'PROCESSING'] } } }),
    db.email.count({ where: { userId, status: 'SENT' } }),
    db.email.count({ where: { userId, status: 'FAILED' } }),
  ]);
  return { scheduled, sent, failed };
}
export async function getEmail(userId: string, id: string) {
  const email = await db.email.findFirst({
    where: { userId, id },
    include: { sender: { select: senderSelect } },
  });
  if (!email) throw new AppError(404, 'NOT_FOUND', 'Email not found.');
  return email;
}
export async function listCampaigns(userId: string, page: number, limit: number) {
  const [data, total] = await db.$transaction([
    db.emailCampaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.emailCampaign.count({ where: { userId } }),
  ]);
  return paginated(data, total, page, limit);
}
export async function getCampaign(userId: string, id: string) {
  const campaign = await db.emailCampaign.findFirst({ where: { userId, id } });
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found.');
  return campaign;
}
export const listSenders = (userId: string) =>
  db.sender.findMany({ where: { userId }, select: senderSelect, orderBy: { createdAt: 'asc' } });
export async function saveSender(userId: string, raw: unknown, id?: string) {
  const input = senderSchema.parse(raw);
  if (id && !(await db.sender.findFirst({ where: { id, userId } })))
    throw new AppError(404, 'NOT_FOUND', 'Sender not found.');
  const data = {
    ...input,
    maxEmailsPerHour: Math.min(input.maxEmailsPerHour, env.MAX_EMAILS_PER_HOUR),
    minDelayMs: Math.max(input.minDelayMs, env.MIN_EMAIL_DELAY_MS),
    etherealPassword: input.etherealPassword ? encrypt(input.etherealPassword) : undefined,
  };
  try {
    return id
      ? await db.sender.update({ where: { id }, data, select: senderSelect })
      : await db.sender.create({ data: { userId, ...data }, select: senderSelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new AppError(409, 'SENDER_EXISTS', 'You already have a sender with that email.');
    throw error;
  }
}
export const slackStatus = (userId: string) =>
  db.slackIntegration.findUnique({
    where: { userId },
    select: { workspaceName: true, channelName: true, connectedAt: true },
  });
export const disconnectSlack = (userId: string) =>
  db.slackIntegration.deleteMany({ where: { userId } });
