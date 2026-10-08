import { Prisma, type EmailStatus } from '@prisma/client';
import { db } from '../config/clients';
export const senderSelect = {
  id: true,
  name: true,
  email: true,
  minDelayMs: true,
  maxEmailsPerHour: true,
} as const;
export function paginated<T>(data: T[], total: number, page: number, limit: number) {
  return {
    success: true as const,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
export async function listEmails(
  userId: string,
  statuses: EmailStatus[],
  page: number,
  limit: number,
) {
  const where = { userId, status: { in: statuses } };
  const [data, total] = await db.$transaction([
    db.email.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: statuses.includes('SENT')
        ? [{ sentAt: 'desc' }, { id: 'asc' }]
        : [{ nextAttemptAt: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
    }),
    db.email.count({ where }),
  ]);
  return paginated(data, total, page, limit);
}
export async function indexEvent(tx: Prisma.TransactionClient, id: string) {
  await tx.outbox.create({ data: { kind: 'INDEX', entityId: id } });
}
export async function claimEmail(id: string, claimToken: string) {
  return db.email.updateMany({
    where: { id, status: 'SCHEDULED' },
    data: { status: 'PROCESSING', claimToken, revision: { increment: 1 } },
  });
}
export async function finalizeEmail(
  id: string,
  claimToken: string,
  data: {
    status: 'SENT' | 'FAILED';
    sentAt?: Date;
    messageId?: string;
    previewUrl?: string | null;
    errorMessage?: string;
  },
) {
  return db.$transaction(async (tx) => {
    const result = await tx.email.updateMany({
      where: { id, status: 'PROCESSING', claimToken },
      data: { ...data, revision: { increment: 1 } },
    });
    if (result.count) await indexEvent(tx, id);
    return result;
  });
}
