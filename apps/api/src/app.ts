import express from 'express';
import session, { type Store } from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { env } from './config/env';
import { db, redis, elastic, logger } from './config/clients';
import { queues } from './queues';
import { routes } from './routes';
import { errorHandler, protectOrigin, requireAuth } from './middleware/security';
import { currentUser } from './services/auth';
import { AppError } from './utils/errors';
export function createApp(store: Store) {
  const app = express();
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: new URL(env.FRONTEND_URL).origin, credentials: true }));
  // Log the path only: OAuth callback query parameters contain authorization codes.
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(express.json({ limit: env.REQUEST_LIMIT_BYTES }));
  app.use(
    session({
      name: 'reachinbox.sid',
      secret: env.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: env.SESSION_TTL_SECONDS * 1000,
      },
    }),
  );
  app.use(protectOrigin);
  app.get('/health', async (_req, res) => {
    const results = await Promise.allSettled([
      db.$queryRaw`SELECT 1`,
      redis.ping(),
      elastic.ping(),
    ]);
    const names = ['postgres', 'redis', 'elasticsearch'];
    const data = Object.fromEntries(
      results.map((result, i) => [names[i], result.status === 'fulfilled' ? 'up' : 'down']),
    );
    const healthy = results.every((result) => result.status === 'fulfilled');
    res.status(healthy ? 200 : 503).json({ success: healthy, data });
  });
  app.use('/api', routes);
  const adapter = new ExpressAdapter();
  adapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue, { readOnlyMode: true })),
    serverAdapter: adapter,
  });
  app.use(
    '/admin/queues',
    requireAuth,
    async (req, _res, next) => {
      if (!(await currentUser(req.session.userId)).isAdmin)
        throw new AppError(
          403,
          'FORBIDDEN',
          'Queue access is restricted to configured administrators.',
        );
      next();
    },
    adapter.getRouter(),
  );
  app.use((_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'This endpoint does not exist.')),
  );
  app.use(errorHandler);
  return app;
}
