import { Navigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useCurrentUser } from '../hooks/queries';
import { Button, Logo } from '../components/ui';
export function Login() {
  const user = useCurrentUser();
  const [params] = useSearchParams();
  if (user.data) return <Navigate to="/dashboard" replace />;
  const error = params.get('error');
  return (
    <div className="login-page">
      <header className="login-header">
        <Logo />
        <span>
          OUTBOX LABS <span className="slash">/</span> EMAIL SCHEDULER
        </span>
      </header>
      <main className="login-main">
        <div className="login-card">
          <span className="eyebrow">A LITTLE AHEAD OF TIME</span>
          <h1>
            Welcome to
            <br />
            your outbox.
          </h1>
          <p className="login-description">
            Good emails deserve good timing.
            <br />
            Let’s get yours ready.
          </p>
          <a
            className="google-button"
            href="/api/auth/google"
            aria-disabled={Boolean(user.error)}
            onClick={(event) => {
              if (user.error) event.preventDefault();
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.6A10 10 0 0 0 12 22Z"
              />
              <path fill="#FBBC05" d="M6.3 13.8a6 6 0 0 1 0-3.6V7.6H3a10 10 0 0 0 0 8.8l3.3-2.6Z" />
              <path
                fill="#EA4335"
                d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.6l3.3 2.6C7.1 7.8 9.4 6 12 6Z"
              />
            </svg>
            Continue with Google
            <ArrowUpRight size={16} />
          </a>
          <div className="login-divider">
            <span />
            Simple. Secure. Yours.
            <span />
          </div>
          <p className="login-note">
            <ShieldCheck size={16} />
            Sign in securely with your Google account.
            <br />
            Your inbox stays private.
          </p>
          {error && (
            <div className="inline-error" role="alert">
              {error === 'configuration'
                ? 'Google sign-in is not configured yet. Add OAuth credentials to the server’s .env file.'
                : 'Google sign-in did not finish. Please try again.'}
            </div>
          )}
          {user.error && (
            <div className="inline-error" role="alert">
              The server is currently unavailable. Please try again.
              <Button
                variant="quiet"
                onClick={() => void user.refetch()}
                disabled={user.isFetching}
              >
                {user.isFetching ? 'Checking…' : 'Try again'}
              </Button>
            </div>
          )}
        </div>
        <span className="login-caption">WRITE NOW. SEND AT THE RIGHT MOMENT.</span>
      </main>
      <footer className="login-footer">
        <span>ReachInbox Scheduler</span>
        <span>Made for a more intentional inbox.</span>
      </footer>
    </div>
  );
}
