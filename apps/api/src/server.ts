import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { createApp } from './app';
import { env } from './config/env';
import { db, redis, logger } from './config/clients';
import { queues } from './queues';
async function main() {
  const sessionRedis = createClient({ url: env.REDIS_URL });
  sessionRedis.on('error', () => logger.error('Session Redis connection error'));
  await sessionRedis.connect();
  await db.$connect();
  if (redis.status === 'wait') await redis.connect();
  const app = createApp(new RedisStore({ client: sessionRedis, prefix: 'session:' }));
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API ready'));
  const stop = () =>
    server.close(() => {
      void Promise.all([
        db.$disconnect(),
        redis.quit(),
        sessionRedis.quit(),
        ...queues.map((q) => q.close()),
      ]).then(() => process.exit(0));
    });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((error) => {
  logger.fatal({ error: error instanceof Error ? error.message : 'Unknown' }, 'API startup failed');
  process.exit(1);
});
