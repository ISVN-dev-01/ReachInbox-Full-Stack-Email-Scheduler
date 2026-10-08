import type { RequestHandler } from 'express';
import { z } from 'zod';
import { paginationSchema } from '../../../../packages/shared/src';
import * as dashboard from '../services/dashboard';
import { createCampaign } from '../services/campaigns';
import { listEmails } from '../repositories/emails';
import { searchEmails } from '../integrations/elasticsearch';
import { env } from '../config/env';
const uuid = z.string().uuid();
export const configuration: RequestHandler = (_req, res) => {
  res.json({
    success: true,
    data: {
      maxUploadBytes: env.MAX_UPLOAD_BYTES,
      maxRecipients: env.MAX_RECIPIENTS,
      minDelayMs: env.MIN_EMAIL_DELAY_MS,
      maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
    },
  });
};
export const summary: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await dashboard.stats(req.session.userId!) });
};
export const create: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json({
      success: true,
      data: await createCampaign(
        req.session.userId!,
        req.body,
        uuid.parse(req.headers['idempotency-key']),
      ),
    });
};
export const campaigns: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query);
  res.json(await dashboard.listCampaigns(req.session.userId!, page, limit));
};
export const campaign: RequestHandler = async (req, res) => {
  res.json({
    success: true,
    data: await dashboard.getCampaign(req.session.userId!, uuid.parse(req.params.id)),
  });
};
export const emails =
  (kind: 'scheduled' | 'sent' | 'failed'): RequestHandler =>
  async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    res.json(
      await listEmails(
        req.session.userId!,
        kind === 'scheduled'
          ? ['SCHEDULED', 'PROCESSING']
          : kind === 'sent'
            ? ['SENT']
            : ['FAILED'],
        page,
        limit,
      ),
    );
  };
export const email: RequestHandler = async (req, res) => {
  res.json({
    success: true,
    data: await dashboard.getEmail(req.session.userId!, uuid.parse(req.params.id)),
  });
};
export const search: RequestHandler = async (req, res) => {
  const input = paginationSchema
    .extend({
      q: z.string().max(300).default(''),
      status: z.enum(['', 'SCHEDULED,PROCESSING', 'SENT', 'FAILED']).default(''),
      campaignId: uuid.optional(),
    })
    .parse(req.query);
  res.json(
    await searchEmails(
      req.session.userId!,
      input.q,
      input.status,
      input.campaignId,
      input.page,
      input.limit,
    ),
  );
};
export const senders: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await dashboard.listSenders(req.session.userId!) });
};
export const sender: RequestHandler = async (req, res) => {
  res
    .status(req.params.id ? 200 : 201)
    .json({
      success: true,
      data: await dashboard.saveSender(
        req.session.userId!,
        req.body,
        req.params.id ? uuid.parse(req.params.id) : undefined,
      ),
    });
};
export const slack: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await dashboard.slackStatus(req.session.userId!) });
};
export const disconnect: RequestHandler = async (req, res) => {
  await dashboard.disconnectSlack(req.session.userId!);
  res.json({ success: true, data: null });
};
