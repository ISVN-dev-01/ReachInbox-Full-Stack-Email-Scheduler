import 'express-session';
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauth?: { provider: 'google' | 'slack'; state: string; expiresAt: number; verifier?: string };
  }
}
