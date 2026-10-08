// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const mocks = vi.hoisted(() => ({ create: vi.fn(), pending: false }));
vi.mock('../apps/web/src/hooks/queries', () => ({
  useSenders: () => ({
    data: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'sender@example.com',
        minDelayMs: 2000,
        maxEmailsPerHour: 200,
      },
    ],
    isPending: false,
  }),
  useConfig: () => ({
    data: {
      maxUploadBytes: 2000000,
      maxRecipients: 10000,
      minDelayMs: 2000,
      maxEmailsPerHour: 200,
    },
    isPending: false,
  }),
  useCreateCampaign: () => ({ mutateAsync: mocks.create, isPending: mocks.pending }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { Compose } from '../apps/web/src/pages/Compose';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pending = false;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/compose']}>
      <Routes>
        <Route path="/compose" element={<Compose />} />
        <Route path="/dashboard" element={<div>Scheduled mailbox</div>} />
      </Routes>
    </MemoryRouter>,
  );
describe('compose interaction', () => {
  it('shows validation instead of creating an empty campaign', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Send Later' }));
    expect(screen.getByRole('alert').textContent).toContain('at least one valid recipient');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('normalizes recipients, reviews the effective schedule, and sends a stable idempotent request', async () => {
    const user = userEvent.setup({ delay: null });
    mocks.create.mockResolvedValue({ id: 'campaign', totalRecipients: 2 });
    mount();
    await user.type(
      screen.getByLabelText('To', { exact: true }),
      'A@example.com,a@example.com,b@example.com,invalid',
    );
    await user.type(screen.getByLabelText('Subject'), 'A thoughtful follow-up');
    await user.type(screen.getByLabelText('Email body'), 'Thanks for your time.');
    expect(screen.getByText('2 valid recipients')).toBeTruthy();
    expect(screen.getByText('1 invalid excluded')).toBeTruthy();
    expect(screen.getByText('1 duplicates removed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Review schedule' }));
    const dialog = screen.getByRole('dialog', { name: 'Ready when you are' });
    expect(within(dialog).getByText('2 seconds')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schedule emails' }));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^[a-f0-9-]{36}$/),
        input: expect.objectContaining({
          recipients: ['a@example.com', 'b@example.com'],
          delayBetweenEmails: 2000,
          hourlyLimit: 200,
        }),
      }),
    );
    expect(await screen.findByText('Scheduled mailbox')).toBeTruthy();
  });
  it('keeps the same request key after an uncertain network failure', async () => {
    mocks.create.mockRejectedValue(new Error('Network failed'));
    mount();
    await userEvent.type(screen.getByLabelText('To', { exact: true }), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Subject'), 'Hello');
    await userEvent.type(screen.getByLabelText('Email body'), 'Hello there');
    await userEvent.click(screen.getByRole('button', { name: 'Review schedule' }));
    const submit = screen.getByRole('button', { name: 'Schedule emails' });
    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0]?.[0].key).toBe(mocks.create.mock.calls[1]?.[0].key);
  });
});
