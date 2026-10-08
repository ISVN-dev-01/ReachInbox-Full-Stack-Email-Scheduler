import { z } from 'zod';
import { db, redis, logger } from '../../config/clients';
import { decrypt } from '../../utils/crypto';
export async function notifyRateLimit(senderId: string, window: number, limit: number) {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    include: { user: { include: { slack: true } } },
  });
  const integration = sender?.user.slack;
  if (!sender || !integration) return;
  const key = `slack-rate-alert:${senderId}:${window}`;
  if (await redis.exists(key)) return;
  const queued = await db.email.count({ where: { senderId, status: 'SCHEDULED' } });
  const start = new Date(window * 3600000).toISOString();
  const end = new Date((window + 1) * 3600000).toISOString();
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decrypt(integration.accessToken)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: integration.channelId,
      text: `⚠️ Email rate limit reached\nSender: ${sender.email}\nHourly limit: ${limit}\nCurrent window: ${start} – ${end} (UTC)\nQueued emails: ${queued}\nEmails will continue automatically in the next available window.`,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = z
    .object({ ok: z.boolean(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || !data.ok)
    throw new Error(`Slack API rejected notification (${data.error ?? response.status})`);
  await redis.set(key, 'sent', 'EX', 7200);
  logger.info({ senderId, window }, 'Slack rate alert delivered');
}
