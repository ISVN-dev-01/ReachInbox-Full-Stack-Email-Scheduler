import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';
process.env.ELASTICSEARCH_URL = process.env.TEST_ELASTICSEARCH_URL || 'http://localhost:9200';
process.env.ELASTICSEARCH_INDEX = 'reachinbox-test-emails';
process.env.SESSION_SECRET = 'test-only-session-secret-never-use-in-production';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:4000/api/auth/google/callback';
process.env.SLACK_REDIRECT_URI = 'http://localhost:4000/api/slack/callback';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
