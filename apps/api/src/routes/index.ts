import { Router } from 'express';
import * as controller from '../controllers/api';
import { requireAuth } from '../middleware/security';
import { beginOAuth, currentUser, finishGoogle, finishSlack } from '../services/auth';
import { env } from '../config/env';
import { redis } from '../config/clients';
import { AppError } from '../utils/errors';
import { createHash } from 'node:crypto';
export const routes = Router();
routes.use('/auth', async (req, _res, next) => {
  // Shared rate limit across API replicas. Do not store client IPs in Redis keys.
  const ip = createHash('sha256')
    .update(req.ip ?? 'unknown')
    .digest('hex');
  const count = (await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
    1,
    `auth-limit:${ip}`,
  )) as number;
  if (count > 60)
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Too many authentication requests. Try again in a minute.',
    );
  next();
});
routes.get('/auth/google', async (req, res) => {
  try {
    res.redirect(await beginOAuth(req, 'google'));
  } catch {
    res.redirect(`${env.FRONTEND_URL}/login?error=configuration`);
  }
});
routes.get('/auth/google/callback', async (req, res) => {
  try {
    await finishGoogle(req);
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch {
    res.redirect(`${env.FRONTEND_URL}/login?error=google`);
  }
});
routes.get('/auth/me', async (req, res) => {
  res.json({ success: true, data: await currentUser(req.session.userId) });
});
routes.post('/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('reachinbox.sid', { path: '/' });
    res.json({ success: true, data: null });
  });
});
routes.use(requireAuth);
routes.get('/config', controller.configuration);
routes.get('/dashboard/stats', controller.summary);
routes.post('/campaigns', controller.create);
routes.get('/campaigns', controller.campaigns);
routes.get('/campaigns/:id', controller.campaign);
routes.get('/emails/search', controller.search);
routes.get('/emails/scheduled', controller.emails('scheduled'));
routes.get('/emails/sent', controller.emails('sent'));
routes.get('/emails/failed', controller.emails('failed'));
routes.get('/emails/:id', controller.email);
routes.get('/senders', controller.senders);
routes.post('/senders', controller.sender);
routes.patch('/senders/:id', controller.sender);
routes.get('/slack/connect', async (req, res) => {
  try {
    res.redirect(await beginOAuth(req, 'slack'));
  } catch {
    res.redirect(`${env.FRONTEND_URL}/settings?error=configuration`);
  }
});
routes.get('/slack/callback', async (req, res) => {
  try {
    await finishSlack(req);
    res.redirect(`${env.FRONTEND_URL}/settings?connected=slack`);
  } catch {
    res.redirect(`${env.FRONTEND_URL}/settings?error=slack`);
  }
});
routes.get('/slack/status', controller.slack);
routes.post('/slack/disconnect', controller.disconnect);
