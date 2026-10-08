import { describe, expect, it } from 'vitest';
import { parseRecipients, campaignSchema, paginationSchema } from '../packages/shared/src';
import { encrypt, decrypt } from '../apps/api/src/utils/crypto';
import { emailJobId } from '../apps/api/src/queues/identity';
describe('recipient import', () => {
  it('reads CSV headers, normalizes, removes duplicates, and counts invalid rows', () => {
    expect(
      parseRecipients(
        'name,email\nJane,JANE@example.com\nOther,jane@example.com\nWrong,not-an-email',
      ),
    ).toMatchObject({ recipients: ['jane@example.com'], duplicates: 1, invalid: 1 });
  });
  it('supports plain text, CRLF, quoted CSV and a BOM', () => {
    expect(
      parseRecipients('\uFEFFemail\r\n"one@example.com"\r\ntwo@example.com').recipients,
    ).toEqual(['one@example.com', 'two@example.com']);
    expect(parseRecipients('one@example.com\ntwo@example.com').recipients).toHaveLength(2);
  });
  it('does not silently accept malformed quotes', () => {
    expect(parseRecipients('email\n"broken').parseErrors.length).toBeGreaterThan(0);
  });
});
describe('request boundaries', () => {
  it('rejects unsafe campaign configuration and malformed recipient data', () => {
    expect(
      campaignSchema.safeParse({
        senderId: 'not-an-id',
        recipients: ['bad'],
        delayBetweenEmails: -1,
      }).success,
    ).toBe(false);
  });
  it('bounds and normalizes pagination', () => {
    expect(paginationSchema.parse({ page: '2', limit: '25' })).toEqual({ page: 2, limit: 25 });
    expect(paginationSchema.safeParse({ limit: '10000' }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: '-1' }).success).toBe(false);
  });
  it('uses stable queue IDs that BullMQ accepts', () => {
    expect(emailJobId('abc')).toBe(emailJobId('abc'));
    expect(emailJobId('abc')).not.toContain(':');
  });
});
describe('credential storage', () => {
  it('authenticates ciphertext and uses fresh nonces', () => {
    const encrypted = encrypt('private-token');
    expect(encrypted).not.toContain('private-token');
    expect(decrypt(encrypted)).toBe('private-token');
    expect(encrypt('private-token')).not.toBe(encrypted);
    const [iv, tag, content] = encrypted.split('.');
    expect(() => decrypt(`${iv}.${tag}.${content}AAA`)).toThrow();
  });
});
