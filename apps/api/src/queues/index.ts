import { Queue } from 'bullmq';
import { redis } from '../config/clients';
const options = { connection: redis };
export const sendQueue = new Queue<{ emailId: string }>('email-send', options);
export const indexQueue = new Queue<{ emailId: string }>('email-index', options);
export const alertQueue = new Queue<{ senderId: string; window: number; limit: number }>(
  'slack-alert',
  options,
);
export const queues = [sendQueue, indexQueue, alertQueue];
