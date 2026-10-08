import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useConfig, useSenders, useSlackStatus } from '../hooks/queries';
import { Button, ErrorState, Loading, Modal } from '../components/ui';
import { post, request } from '../api/client';
import type { SenderView } from '@reachinbox/shared';
export function Settings() {
  const slack = useSlackStatus();
  const senders = useSenders();
  const config = useConfig();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SenderView | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    const input = {
      name: String(form.get('name')),
      email: String(form.get('email')),
      minDelayMs: Number(form.get('delay')) * 1000,
      maxEmailsPerHour: Number(form.get('limit')),
      ...(form.get('etherealUser')
        ? {
            etherealUser: String(form.get('etherealUser')),
            etherealPassword: String(form.get('etherealPassword')),
          }
        : {}),
    };
    try {
      await request(`/senders${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      });
      await client.invalidateQueries({ queryKey: ['senders'] });
      setOpen(false);
      toast.success('Sender saved');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await post('/slack/disconnect');
      await client.invalidateQueries({ queryKey: ['slack'] });
      toast.success('Slack disconnected');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-page">
      <div className="page-heading">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h1>Settings</h1>
        <p>Your senders, your pace, your workspace.</p>
      </div>
      {params.get('error') && (
        <p role="alert" className="inline-error">
          Slack could not be connected. Check the server’s OAuth configuration and try again.
        </p>
      )}
      {params.get('connected') && (
        <p className="success-note">
          <Check size={16} />
          Slack is connected.
        </p>
      )}
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Slack integration</h2>
            <p>A heads-up when your sender reaches its hourly limit.</p>
          </div>
          <span className={`connection-pill ${slack.data ? 'connected' : ''}`}>
            {slack.data ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {slack.isPending ? (
          <Loading label="Checking Slack…" />
        ) : slack.error ? (
          <ErrorState error={slack.error} retry={() => void slack.refetch()} />
        ) : (
          <>
            <div className="slack-description">
              <div className="slack-mark" aria-hidden="true">
                #
              </div>
              <div>
                <strong>{slack.data?.workspaceName ?? 'Keep your team in the loop'}</strong>
                <p>
                  {slack.data
                    ? `Notifications go to ${slack.data.channelName}`
                    : 'Connect a workspace and choose a channel for rate-limit alerts.'}
                </p>
              </div>
            </div>
            <div className="settings-actions">
              {slack.data && (
                <Button variant="quiet" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect
                </Button>
              )}
              <a className="button button-outline" href="/api/slack/connect">
                {slack.data ? 'Reconnect Slack' : 'Connect Slack'}
                <ExternalLink size={14} />
              </a>
            </div>
          </>
        )}
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Sender accounts</h2>
            <p>Control the sending pace for each account.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={15} />
            Add sender
          </Button>
        </div>
        {senders.isPending ? (
          <Loading label="Loading senders…" />
        ) : senders.error ? (
          <ErrorState error={senders.error} />
        ) : (
          <div className="sender-list">
            {senders.data.map((sender) => (
              <div className="sender-card" key={sender.id}>
                <div>
                  <strong>{sender.name}</strong>
                  <p>{sender.email}</p>
                </div>
                <div className="sender-limits">
                  <span>{sender.maxEmailsPerHour}/hour</span>
                  <span>{sender.minDelayMs / 1000}s min. delay</span>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Edit ${sender.email}`}
                  onClick={() => {
                    setEditing(sender);
                    setOpen(true);
                  }}
                >
                  <SlidersHorizontal size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="field-hint">
          Limits are shared across workers. Campaigns can use a slower pace or lower hourly limit.
        </p>
      </section>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={editing ? 'Edit sender' : 'Add a sender'}
      >
        <form key={editing?.id ?? 'new'} className="sender-form" onSubmit={(e) => void save(e)}>
          <label>
            Name
            <input
              name="name"
              className="form-input"
              required
              maxLength={100}
              defaultValue={editing?.name}
            />
          </label>
          <label>
            Email address
            <input
              name="email"
              className="form-input"
              type="email"
              required
              defaultValue={editing?.email}
            />
          </label>
          <div className="form-columns">
            <label>
              Minimum delay (seconds)
              <input
                name="delay"
                className="form-input"
                type="number"
                min={(config.data?.minDelayMs ?? 2000) / 1000}
                step="0.001"
                required
                defaultValue={(editing?.minDelayMs ?? config.data?.minDelayMs ?? 2000) / 1000}
              />
            </label>
            <label>
              Hourly limit
              <input
                name="limit"
                className="form-input"
                type="number"
                min={1}
                max={config.data?.maxEmailsPerHour ?? 200}
                required
                defaultValue={editing?.maxEmailsPerHour ?? config.data?.maxEmailsPerHour ?? 200}
              />
            </label>
          </div>
          <details>
            <summary>Sender-specific Ethereal credentials</summary>
            <p className="field-hint">
              Optional. Leave blank to keep existing credentials or use the configured development
              account.
            </p>
            <label>
              Ethereal username
              <input name="etherealUser" className="form-input" type="email" autoComplete="off" />
            </label>
            <label>
              Ethereal password
              <input
                name="etherealPassword"
                className="form-input"
                type="password"
                autoComplete="new-password"
              />
            </label>
          </details>
          <div className="modal-actions">
            <Button variant="quiet" type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save sender'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
