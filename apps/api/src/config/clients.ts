import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Client } from '@elastic/elasticsearch';
import pino from 'pino';
import { env } from './env';
export const db = new PrismaClient();
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
export const elastic = new Client({
  node: env.ELASTICSEARCH_URL,
  ...(env.ELASTICSEARCH_API_KEY ? { auth: { apiKey: env.ELASTICSEARCH_API_KEY } } : {}),
});
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: [
    'req.headers.cookie',
    'req.headers.authorization',
    'password',
    'accessToken',
    'etherealPassword',
    'secret',
  ],
});
redis.on('error', (error) => logger.error({ message: error.message }, 'Redis connection error'));
