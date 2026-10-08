import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  List,
  LoaderCircle,
  Quote,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseRecipients, type CampaignInput } from '@reachinbox/shared';
import { useConfig, useCreateCampaign, useSenders } from '../hooks/queries';
import { Button, ErrorState, Loading, Modal, formatDate } from '../components/ui';
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function Compose() {
  const navigate = useNavigate();
  const senders = useSenders();
  const config = useConfig();
  const mutation = useCreateCampaign();
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseRecipients>>({
    recipients: [],
    invalid: 0,
    duplicates: 0,
    parseErrors: [],
  });
  const [start, setStart] = useState(localDate(new Date(Date.now() + 300000)));
  const [delay, setDelay] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [fileName, setFileName] = useState('');
  const [validation, setValidation] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const submission = useRef({ key: '', content: '' });
  if (senders.isPending || config.isPending) return <Loading label="Preparing your outbox…" />;
  if (senders.error || config.error)
    return (
      <ErrorState
        error={senders.error ?? config.error!}
        retry={() => {
          void senders.refetch();
          void config.refetch();
        }}
      />
    );
  const selected = senders.data.find((sender) => sender.id === senderId) ?? senders.data[0];
  const minDelay = Math.max(config.data.minDelayMs, selected?.minDelayMs ?? 0) / 1000;
  const maxLimit = Math.min(config.data.maxEmailsPerHour, selected?.maxEmailsPerHour ?? Infinity);
  const effectiveDelay = Math.max(delay ?? minDelay, minDelay);
  const effectiveLimit = Math.min(limit ?? maxLimit, maxLimit);
  const currentRecipients = parseRecipients(recipientText);
  const recipients = [...new Set([...parsed.recipients, ...currentRecipients.recipients])];
  const invalid = parsed.invalid + currentRecipients.invalid;
  const duplicates =
    parsed.duplicates +
    currentRecipients.duplicates +
    parsed.recipients.filter((value) => currentRecipients.recipients.includes(value)).length;
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    if (file.size > config.data.maxUploadBytes) {
      toast.error(
        `File must be smaller than ${(config.data.maxUploadBytes / 1048576).toFixed(0)} MB.`,
      );
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error('Choose a .csv or .txt file.');
      return;
    }
    const result = parseRecipients(await file.text());
    if (result.parseErrors.length) {
      toast.error(`Could not read this file: ${result.parseErrors[0]}`);
      return;
    }
    setParsed(result);
    setFileName(file.name);
    setValidation('');
  };
  const insert = (prefix: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const before = body.slice(0, editor.selectionStart);
    const after = body.slice(editor.selectionEnd);
    setBody(`${before}${before && !before.endsWith('\n') ? '\n' : ''}${prefix}${after}`);
    editor.focus();
  };
  const validate = () => {
    if (!selected) return 'Create a sender account in Settings first.';
    if (!recipients.length) return 'Add at least one valid recipient.';
    if (recipients.length > config.data.maxRecipients)
      return `Use no more than ${config.data.maxRecipients.toLocaleString()} recipients.`;
    if (!subject.trim() || !body.trim()) return 'Add a subject and message before scheduling.';
    if (!Number.isFinite(effectiveDelay) || effectiveDelay < minDelay || effectiveDelay > 86400)
      return 'Choose a valid delay within the sender limits.';
    if (!Number.isInteger(effectiveLimit) || effectiveLimit < 1)
      return 'Hourly limit must be a positive whole number.';
    if (!start || new Date(start).getTime() < Date.now())
      return 'Choose a start time in the future.';
    return '';
  };
  const schedule = async () => {
    const error = validate();
    if (error) {
      setValidation(error);
      setReview(false);
      return;
    }
    const input: CampaignInput = {
      senderId: selected!.id,
      subject,
      body,
      recipients,
      startTime: new Date(start).toISOString(),
      delayBetweenEmails: Math.round(effectiveDelay * 1000),
      hourlyLimit: effectiveLimit,
    };
    const content = JSON.stringify(input);
    if (submission.current.content !== content)
      submission.current = { key: crypto.randomUUID(), content };
    try {
      const result = await mutation.mutateAsync({ input, key: submission.current.key });
      toast.success(`${result.totalRecipients.toLocaleString()} emails scheduled`, {
        description: 'You can follow their progress in Scheduled.',
      });
      navigate('/dashboard');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const dirty = Boolean(subject || body || recipients.length);
  return (
    <div className="compose-page">
      <header className="compose-header">
        <button
          className="icon-button"
          aria-label="Back to scheduled emails"
          onClick={() => (dirty ? setDiscard(true) : navigate('/dashboard'))}
        >
          <ArrowLeft size={21} />
        </button>
        <h1>Compose New Email</h1>
        <div className="compose-actions">
          <button
            className="icon-button"
            title="Choose send time"
            aria-label="Choose send time"
            onClick={() => setScheduleOpen(true)}
          >
            <Clock3 size={20} />
          </button>
          <Button
            variant="outline"
            onClick={() => {
              const error = validate();
              setValidation(error);
              if (!error) setReview(true);
            }}
          >
            Send Later
          </Button>
        </div>
      </header>
      <form
        className="compose-form"
        onSubmit={(e) => {
          e.preventDefault();
          const error = validate();
          setValidation(error);
          if (!error) setReview(true);
        }}
      >
        <div className="compose-field">
          <label htmlFor="sender">From</label>
          <select
            id="sender"
            value={selected?.id ?? ''}
            onChange={(e) => setSenderId(e.target.value)}
          >
            {senders.data.map((sender) => (
              <option value={sender.id} key={sender.id}>
                {sender.email}
              </option>
            ))}
          </select>
        </div>
        <div className="compose-field recipient-field">
          <label htmlFor="recipients">To</label>
          <div className="recipient-entry">
            {parsed.recipients.slice(0, 3).map((recipient) => (
              <span className="recipient-chip" key={recipient}>
                {recipient}
              </span>
            ))}
            {parsed.recipients.length > 3 && (
              <span className="recipient-chip">+{parsed.recipients.length - 3}</span>
            )}
            <input
              id="recipients"
              placeholder={
                parsed.recipients.length ? 'Add another recipient' : 'recipient@example.com'
              }
              value={recipientText}
              onChange={(e) => setRecipientText(e.target.value)}
              aria-describedby="recipient-help"
            />
          </div>
          <button type="button" className="upload-link" onClick={() => fileRef.current?.click()}>
            <Upload size={14} />
            <span>Upload List</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => void upload(e)}
            aria-label="Upload recipients CSV or text file"
          />
        </div>
        {(fileName || recipientText) && (
          <div className="recipient-report" id="recipient-help">
            <span className="valid-report">
              <Check size={13} />
              {recipients.length.toLocaleString()} valid recipients
            </span>
            {invalid > 0 && <span className="invalid-report">{invalid} invalid excluded</span>}
            {duplicates > 0 && <span>{duplicates} duplicates removed</span>}
            {fileName && (
              <button
                type="button"
                onClick={() => {
                  setParsed({ recipients: [], invalid: 0, duplicates: 0, parseErrors: [] });
                  setFileName('');
                }}
              >
                {fileName}
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="compose-field subject-field">
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            required
            maxLength={300}
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="compose-controls">
          <label>
            Delay between 2 emails{' '}
            <span className="number-input">
              <input
                type="number"
                min={minDelay}
                max={86400}
                step="0.001"
                value={effectiveDelay}
                onChange={(e) => setDelay(Number(e.target.value))}
                aria-label="Delay between emails in seconds"
              />
              <span>sec</span>
            </span>
          </label>
          <label>
            Hourly limit{' '}
            <span className="number-input">
              <input
                type="number"
                min={1}
                max={maxLimit}
                value={effectiveLimit}
                onChange={(e) => setLimit(Number(e.target.value))}
                aria-label="Hourly sending limit"
              />
              <span>/hr</span>
            </span>
          </label>
        </div>
        <div className="message-editor">
          <label htmlFor="message" className="sr-only">
            Email body
          </label>
          <textarea
            id="message"
            ref={editorRef}
            required
            maxLength={100000}
            placeholder="Write something worth opening…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="editor-toolbar">
            <span className="plain-label">Plain text</span>
            <span className="toolbar-divider" />
            <button
              type="button"
              className="icon-button"
              title="Insert a list item"
              aria-label="Insert list item"
              onClick={() => insert('• ')}
            >
              <List size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Insert a quote"
              aria-label="Insert quote"
              onClick={() => insert('> ')}
            >
              <Quote size={16} />
            </button>
            <span className="character-count">{body.length.toLocaleString()} characters</span>
          </div>
        </div>
        <div className="schedule-summary">
          <button type="button" onClick={() => setScheduleOpen(true)}>
            <CalendarDays size={17} />
            <span>
              Starts{' '}
              <strong>{start ? formatDate(new Date(start).toISOString()) : 'Choose a time'}</strong>
            </span>
            <span className="text-link">Change</span>
          </button>
          <p>
            {recipients.length.toLocaleString()} recipients · {effectiveDelay}s between emails · Up
            to {effectiveLimit}/hour
          </p>
          <small>
            {Intl.DateTimeFormat().resolvedOptions().timeZone} · Sender limits apply across all
            campaigns.
          </small>
        </div>
        {validation && (
          <p className="inline-error" role="alert">
            {validation}
          </p>
        )}
        <div className="compose-bottom">
          <span>Review your schedule before it goes out.</span>
          <Button type="submit">
            <Clock3 size={15} />
            Review schedule
          </Button>
        </div>
      </form>
      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Send Later">
        <label className="field-label" htmlFor="start-time">
          Pick date & time
        </label>
        <input
          className="form-input"
          type="datetime-local"
          id="start-time"
          value={start}
          min={localDate(new Date())}
          onChange={(e) => setStart(e.target.value)}
        />
        <p className="field-hint">
          Your time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        <div className="schedule-presets">
          {[9, 10, 15].map((hour) => (
            <button
              key={hour}
              onClick={() => {
                const next = new Date();
                next.setDate(next.getDate() + 1);
                next.setHours(hour, 0, 0, 0);
                setStart(localDate(next));
              }}
            >
              Tomorrow, {hour > 12 ? hour - 12 : hour}:00 {hour >= 12 ? 'PM' : 'AM'}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <Button variant="quiet" onClick={() => setScheduleOpen(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => setScheduleOpen(false)}>
            Done
          </Button>
        </div>
      </Modal>
      <Modal
        open={review}
        onClose={() => {
          if (!mutation.isPending) setReview(false);
        }}
        title="Ready when you are"
      >
        <p className="muted">Each recipient gets their own email. Here’s your schedule.</p>
        <dl className="review-list">
          <div>
            <dt>From</dt>
            <dd>{selected?.email}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{subject}</dd>
          </div>
          <div>
            <dt>Recipients</dt>
            <dd>{recipients.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Starts</dt>
            <dd>{start && formatDate(new Date(start).toISOString())}</dd>
          </div>
          <div>
            <dt>Delay</dt>
            <dd>{effectiveDelay} seconds</dd>
          </div>
          <div>
            <dt>Hourly limit</dt>
            <dd>{effectiveLimit} emails</dd>
          </div>
        </dl>
        <p className="field-hint">
          Delivery may be later when your sender reaches its hourly limit. Emails remain scheduled
          until capacity is available.
        </p>
        <div className="modal-actions">
          <Button variant="quiet" disabled={mutation.isPending} onClick={() => setReview(false)}>
            Keep editing
          </Button>
          <Button disabled={mutation.isPending} onClick={() => void schedule()}>
            {mutation.isPending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Schedule emails
          </Button>
        </div>
      </Modal>
      <Modal open={discard} onClose={() => setDiscard(false)} title="Leave this draft?">
        <p className="muted">Your unscheduled draft will be discarded.</p>
        <div className="modal-actions">
          <Button variant="quiet" onClick={() => setDiscard(false)}>
            Keep editing
          </Button>
          <Button onClick={() => navigate('/dashboard')}>Discard draft</Button>
        </div>
      </Modal>
    </div>
  );
}
