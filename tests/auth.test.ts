import type { Request } from 'express';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ tokens: vi.fn(), verify: vi.fn(), user: vi.fn() }));
vi.mock('google-auth-library', () => ({
  CodeChallengeMethod: { S256: 'S256' },
  OAuth2Client: class {
    getToken = mocks.tokens;
    verifyIdToken = mocks.verify;
  },
}));
vi.mock('../apps/api/src/config/clients', () => ({ db: { user: { upsert: mocks.user } } }));
import { finishGoogle } from '../apps/api/src/services/auth';
function callback(state = 'valid-state', expiresAt = Date.now() + 60000) {
  const req = {
    query: { state, code: 'one-time-code' },
    session: {
      oauth: { provider: 'google', state: 'valid-state', verifier: 'pkce', expiresAt },
      save: vi.fn((done: () => void) => done()),
      regenerate: vi.fn((done: () => void) => done()),
      userId: undefined,
    },
  };
  return req as unknown as Request;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tokens.mockResolvedValue({ tokens: { id_token: 'identity-token' } });
  mocks.verify.mockResolvedValue({
    getPayload: () => ({
      sub: 'google-identity',
      email: 'verified@example.com',
      email_verified: true,
      name: 'Verified User',
    }),
  });
  mocks.user.mockResolvedValue({ id: 'user' });
});
it('rejects OAuth state mismatches before token exchange', async () => {
  await expect(finishGoogle(callback('attacker'))).rejects.toMatchObject({
    code: 'INVALID_OAUTH_STATE',
  });
  expect(mocks.tokens).not.toHaveBeenCalled();
});
it('rejects expired OAuth callbacks', async () => {
  await expect(finishGoogle(callback('valid-state', 0))).rejects.toMatchObject({
    code: 'INVALID_OAUTH_STATE',
  });
  expect(mocks.tokens).not.toHaveBeenCalled();
});
it('verifies the identity token, forwards PKCE, consumes state and rotates the session', async () => {
  const req = callback();
  await finishGoogle(req);
  expect(mocks.tokens).toHaveBeenCalledWith({ code: 'one-time-code', codeVerifier: 'pkce' });
  expect(mocks.verify).toHaveBeenCalled();
  expect(req.session.regenerate).toHaveBeenCalled();
  expect(req.session.oauth).toBeUndefined();
  expect(req.session.userId).toBe('user');
});
