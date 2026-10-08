import { z } from 'zod';
import Papa from 'papaparse';

export const emailAddress = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const campaignSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(100000),
  recipients: z.array(emailAddress).min(1).max(10000),
  startTime: z.string().datetime({ offset: true }),
  delayBetweenEmails: z.number().int().min(0).max(86400000),
  hourlyLimit: z.number().int().min(1).max(100000),
});
export type CampaignInput = z.infer<typeof campaignSchema>;
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const senderSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailAddress,
    maxEmailsPerHour: z.number().int().min(1).max(100000),
    minDelayMs: z.number().int().min(0).max(86400000),
    etherealUser: z.string().email().optional(),
    etherealPassword: z.string().min(1).max(500).optional(),
  })
  .refine(
    (v) => Boolean(v.etherealUser) === Boolean(v.etherealPassword),
    'Provide both SMTP credentials or neither',
  );

export function parseRecipients(text: string) {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' });
  const rows = parsed.data;
  const header =
    rows[0]?.findIndex((cell) => /^(email|email address|e-mail)$/i.test(cell.trim())) ?? -1;
  const candidates = header >= 0 ? rows.slice(1).map((row) => row[header] ?? '') : rows.flat();
  const valid = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    const result = emailAddress.safeParse(candidate);
    if (!result.success) invalid++;
    else if (valid.has(result.data)) duplicates++;
    else valid.add(result.data);
  }
  return {
    recipients: [...valid],
    invalid,
    duplicates,
    parseErrors: parsed.errors
      .filter((e) => e.code !== 'UndetectableDelimiter')
      .map((e) => e.message),
  };
}
export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';
export interface Profile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}
export interface SenderView {
  id: string;
  name: string;
  email: string;
  maxEmailsPerHour: number;
  minDelayMs: number;
}
export interface EmailView {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  previewUrl: string | null;
  campaignId: string;
  senderId: string;
  sequenceNumber: number;
}
export interface Page<T> {
  success: true;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface SlackView {
  workspaceName: string;
  channelName: string;
  connectedAt: string;
}
