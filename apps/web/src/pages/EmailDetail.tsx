import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEmail } from '../hooks/queries';
import { Avatar, Badge, ErrorState, Loading, formatDate } from '../components/ui';
export function EmailDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useEmail(id);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const email = query.data;
  return (
    <article className="email-detail">
      <header className="detail-header">
        <button className="icon-button" aria-label="Back to mailbox" onClick={() => navigate(-1)}>
          <ArrowLeft size={21} />
        </button>
        <h1>{email.subject}</h1>
        <Badge status={email.status} />
      </header>
      <div className="detail-content">
        <div className="detail-sender">
          <Avatar name={email.sender.name} />
          <div>
            <strong>{email.sender.name}</strong> <span>&lt;{email.sender.email}&gt;</span>
            <p>To {email.recipient}</p>
          </div>
          <time>{formatDate(email.sentAt ?? email.nextAttemptAt)}</time>
        </div>
        <div className="email-body">{email.body}</div>
        {email.errorMessage && <p className="inline-error">{email.errorMessage}</p>}
        <dl className="delivery-details">
          <div>
            <dt>Originally scheduled</dt>
            <dd>{formatDate(email.scheduledAt)}</dd>
          </div>
          {email.status === 'SCHEDULED' && (
            <div>
              <dt>Next attempt</dt>
              <dd>{formatDate(email.nextAttemptAt)}</dd>
            </div>
          )}
          <div>
            <dt>Campaign ID</dt>
            <dd>
              <code>{email.campaignId}</code>
            </dd>
          </div>
          <div>
            <dt>Sequence</dt>
            <dd>{email.sequenceNumber + 1}</dd>
          </div>
        </dl>
        {email.previewUrl && (
          <a
            className="button button-outline"
            href={email.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Ethereal preview
            <ExternalLink size={15} />
          </a>
        )}
      </div>
    </article>
  );
}
