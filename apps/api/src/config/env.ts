import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
let directory = process.cwd();
while (!existsSync(join(directory, '.env')) && dirname(directory) !== directory)
  directory = dirname(directory);
dotenv.config({ path: join(directory, '.env') });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ELASTICSEARCH_URL: z.string().url(),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails'),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().url(),
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z.string().url(),
  ETHEREAL_USER: z.string().default(''),
  ETHEREAL_PASSWORD: z.string().default(''),
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().default(587),
  ETHEREAL_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
  INDEX_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  SLACK_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
  MIN_EMAIL_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().positive().default(200),
  MAX_RECIPIENTS: z.coerce.number().int().min(1).max(10000).default(10000),
  MAX_UPLOAD_BYTES: z.coerce.number().positive().default(2097152),
  REQUEST_LIMIT_BYTES: z.coerce.number().positive().default(5242880),
  SESSION_TTL_SECONDS: z.coerce.number().positive().default(604800),
  SENDER_LEASE_MS: z.coerce.number().min(60000).default(120000),
  SMTP_TIMEOUT_MS: z.coerce.number().positive().max(30000).default(30000),
  FRONTEND_URL: z.string().url(),
  ADMIN_EMAILS: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success)
  throw new Error(
    `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`,
  );
export const env = parsed.data;
export const isAdmin = (email: string) =>
  env.ADMIN_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(email.toLowerCase());
