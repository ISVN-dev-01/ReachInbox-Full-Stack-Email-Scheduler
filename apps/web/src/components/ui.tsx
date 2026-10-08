import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { AlertCircle, ArrowRight, Clock3, LoaderCircle, Mail, X } from 'lucide-react';
import type { EmailStatus } from '@reachinbox/shared';
export function Logo() {
  return (
    <span className="wordmark" aria-label="Outbox Labs">
      ONG
      <span className="brand-dot" />
    </span>
  );
}
export function Button({
  children,
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'quiet' }) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Loading({ label = 'Loading your emails…' }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <LoaderCircle className="animate-spin" size={22} />
      <p>{label}</p>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="state-panel" role="alert">
      <AlertCircle size={25} />
      <h3>We couldn’t load this</h3>
      <p>{error.message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  kind = 'scheduled',
  searching = false,
}: {
  kind?: string;
  searching?: boolean;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {kind === 'scheduled' ? (
          <Clock3 size={27} strokeWidth={1.4} />
        ) : (
          <Mail size={27} strokeWidth={1.4} />
        )}
      </div>
      <h2>
        {searching
          ? 'No matching emails'
          : kind === 'scheduled'
            ? 'A little planning. A better inbox.'
            : kind === 'sent'
              ? 'Your sent emails will land here'
              : 'All clear so far'}
      </h2>
      <p>
        {searching
          ? 'Try another subject, recipient, or campaign.'
          : kind === 'scheduled'
            ? 'Write your next email and choose the right moment to send it.'
            : kind === 'sent'
              ? 'Once your scheduled emails are sent, you can find every detail here.'
              : 'Emails that need your attention will appear here.'}
      </p>
      {!searching && kind === 'scheduled' && (
        <a className="text-link" href="/compose">
          Compose your first email <ArrowRight size={15} />
        </a>
      )}
    </div>
  );
}
export function Badge({ status }: { status: EmailStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {status === 'PROCESSING' && <LoaderCircle size={11} className="animate-spin" />}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
      className="modal"
    >
      <div className="modal-inner">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Avatar({ name, url }: { name: string; url?: string | null }) {
  return url ? (
    <img className="avatar" src={url} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>
  );
}
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
