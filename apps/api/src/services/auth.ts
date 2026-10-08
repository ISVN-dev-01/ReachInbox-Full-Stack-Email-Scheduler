import { randomBytes } from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../config/clients';
import { env, isAdmin } from '../config/env';
import { equalState, encrypt } from '../utils/crypto';
import { AppError } from '../utils/errors';
const google = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL,
);
const saveSession = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
export async function beginOAuth(req: Request, provider: 'google' | 'slack') {
  if (
    provider === 'google'
      ? !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET
      : !env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET
  )
    throw new AppError(
      503,
      'OAUTH_NOT_CONFIGURED',
      `${provider === 'google' ? 'Google' : 'Slack'} OAuth credentials have not been configured.`,
    );
  const state = randomBytes(32).toString('hex');
  const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
  req.session.oauth = { provider, state, verifier: codeVerifier, expiresAt: Date.now() + 600000 };
  await saveSession(req);
  if (provider === 'google')
    return google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
    });
  return `https://slack.com/oauth/v2/authorize?${new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, redirect_uri: env.SLACK_REDIRECT_URI, scope: 'chat:write,incoming-webhook', state })}`;
}
async function consumeState(req: Request, provider: 'google' | 'slack') {
  const saved = req.session.oauth;
  const state = req.query.state;
  delete req.session.oauth;
  await saveSession(req);
  if (
    !saved ||
    saved.provider !== provider ||
    saved.expiresAt < Date.now() ||
    typeof state !== 'string' ||
    !equalState(state, saved.state)
  )
    throw new AppError(
      400,
      'INVALID_OAUTH_STATE',
      'Your sign-in request expired. Please try again.',
    );
  if (req.query.error) throw new AppError(400, 'OAUTH_CANCELLED', 'Authorization was cancelled.');
  return { code: z.string().min(1).parse(req.query.code), verifier: saved.verifier };
}
export async function finishGoogle(req: Request) {
  const { code, verifier } = await consumeState(req, 'google');
  const { tokens } = await google.getToken({ code, codeVerifier: verifier });
  if (!tokens.id_token)
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google did not provide an identity token.');
  const ticket = await google.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const profile = ticket.getPayload();
  if (!profile?.email || !profile.email_verified)
    throw new AppError(401, 'UNVERIFIED_EMAIL', 'A verified Google email is required.');
  const user = await db.user.upsert({
    where: { googleId: profile.sub },
    update: {
      name: profile.name ?? profile.email,
      email: profile.email,
      avatarUrl: profile.picture,
    },
    create: {
      googleId: profile.sub,
      name: profile.name ?? profile.email,
      email: profile.email,
      avatarUrl: profile.picture,
      senders: {
        create: {
          name: profile.name ?? profile.email,
          email: profile.email,
          minDelayMs: env.MIN_EMAIL_DELAY_MS,
          maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
        },
      },
    },
  });
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.userId = user.id;
  await saveSession(req);
}
export async function currentUser(userId: string | undefined) {
  if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your account could not be found.');
  return { ...user, isAdmin: isAdmin(user.email) };
}
export async function finishSlack(req: Request) {
  const { code } = await consumeState(req, 'slack');
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = z
    .object({
      ok: z.literal(true),
      access_token: z.string(),
      team: z.object({ id: z.string(), name: z.string() }),
      incoming_webhook: z.object({ channel_id: z.string(), channel: z.string() }),
    })
    .safeParse(await response.json());
  if (!result.success)
    throw new AppError(
      502,
      'SLACK_OAUTH_FAILED',
      'Slack could not be connected. Please retry and choose a channel.',
    );
  const value = result.data;
  const data = {
    workspaceId: value.team.id,
    workspaceName: value.team.name,
    accessToken: encrypt(value.access_token),
    channelId: value.incoming_webhook.channel_id,
    channelName: value.incoming_webhook.channel,
    connectedAt: new Date(),
  };
  await db.slackIntegration.upsert({
    where: { userId: req.session.userId! },
    create: { userId: req.session.userId!, ...data },
    update: data,
  });
}
