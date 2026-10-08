import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEmails } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorState, formatDate } from '../components/ui';
export function Dashboard({ kind }: { kind: 'scheduled' | 'sent' | 'failed' }) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(false);
  const [campaign, setCampaign] = useState('');
  const [campaignDraft, setCampaignDraft] = useState('');
  const result = useEmails(kind, page, search, campaign);
  const client = useQueryClient();
  const searchNow = (event: FormEvent) => {
    event.preventDefault();
    setSearch(draft.trim());
    setPage(1);
  };
  const total = result.data?.pagination.total ?? 0;
  return (
    <section className="mailbox">
      <div className="mailbox-toolbar">
        <form className="search-box" onSubmit={searchNow}>
          <Search size={17} />
          <input
            aria-label="Search emails by recipient or subject"
            placeholder="Search your emails"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draft && (
            <button
              aria-label="Clear search"
              type="button"
              onClick={() => {
                setDraft('');
                setSearch('');
                setPage(1);
              }}
            >
              <X size={15} />
            </button>
          )}
          <kbd>↵</kbd>
        </form>
        <button
          className={`icon-button ${filter ? 'is-selected' : ''}`}
          aria-label="Filter by campaign"
          aria-expanded={filter}
          onClick={() => setFilter(!filter)}
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Refresh emails"
          onClick={() => void client.invalidateQueries()}
        >
          <RefreshCw size={17} className={result.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      {filter && (
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setCampaign(campaignDraft);
            setPage(1);
          }}
        >
          <label htmlFor="campaign-filter">Campaign ID</label>
          <input
            id="campaign-filter"
            placeholder="Paste a campaign ID"
            value={campaignDraft}
            onChange={(e) => setCampaignDraft(e.target.value)}
          />
          <Button variant="outline" type="submit">
            Apply
          </Button>
          {campaign && (
            <Button
              variant="quiet"
              type="button"
              onClick={() => {
                setCampaign('');
                setCampaignDraft('');
              }}
            >
              Clear
            </Button>
          )}
        </form>
      )}
      <div className="mailbox-heading">
        <div>
          <h1>
            {kind === 'scheduled' ? 'Scheduled' : kind === 'sent' ? 'Sent' : 'Needs attention'}
            <span className="count-pill">{total}</span>
          </h1>
          <p>
            {kind === 'scheduled'
              ? 'Ready to go, when the time is right.'
              : kind === 'sent'
                ? 'A record of every email on its way.'
                : 'Review delivery issues before scheduling again.'}
          </p>
        </div>
        <span className="timezone-label">
          Times in {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}
        </span>
      </div>
      {result.isPending ? (
        <div aria-label="Loading emails" role="status" className="mail-skeleton">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : result.error ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : !result.data.data.length ? (
        <EmptyState kind={kind} searching={!!search || !!campaign} />
      ) : (
        <div className="email-list" aria-label={`${kind} emails`}>
          {result.data.data.map((email) => (
            <Link to={`/emails/${email.id}`} className="email-row" key={email.id}>
              <div className="email-recipient">
                <span>To:</span> {email.recipient}
              </div>
              <div className="email-content">
                <div className="email-line">
                  {kind === 'scheduled' ? (
                    <span className="schedule-badge">
                      <Clock3 size={12} />
                      {formatDate(email.nextAttemptAt)}
                    </span>
                  ) : (
                    <Badge status={email.status} />
                  )}
                  <strong>{email.subject}</strong>
                  <span className="email-excerpt">— {email.body.replaceAll('\n', ' ')}</span>
                </div>
                {email.errorMessage && <span className="email-error">{email.errorMessage}</span>}
              </div>
              <span className="email-row-end">
                {kind === 'sent' && email.sentAt ? (
                  formatDate(email.sentAt)
                ) : (
                  <ChevronRight size={16} />
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
      {total > 0 && (
        <footer className="pagination">
          <span>
            {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total.toLocaleString()} emails
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              Page {page} of {result.data?.pagination.totalPages}
            </span>
            <button
              className="icon-button"
              aria-label="Next page"
              disabled={page >= (result.data?.pagination.totalPages ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
