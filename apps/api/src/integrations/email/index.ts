import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender, Email } from '@prisma/client';
import { env } from '../../config/env';
import { decrypt } from '../../utils/crypto';
const transports = new Map<string, Transporter>();
export async function sendEmail(email: Email, sender: Sender) {
  const key = `${sender.id}-${sender.updatedAt.toISOString()}`;
  let transport = transports.get(key);
  if (!transport) {
    // Bound idle transports when sender settings change or many senders are used.
    if (transports.size >= 100) {
      const first = transports.keys().next().value;
      if (first) {
        transports.get(first)?.close();
        transports.delete(first);
      }
    }
    transport = nodemailer.createTransport({
      host: env.ETHEREAL_HOST,
      port: env.ETHEREAL_PORT,
      secure: env.ETHEREAL_SECURE,
      pool: true,
      maxConnections: 1,
      auth: {
        user: sender.etherealUser ?? env.ETHEREAL_USER,
        pass: sender.etherealPassword ? decrypt(sender.etherealPassword) : env.ETHEREAL_PASSWORD,
      },
      connectionTimeout: env.SMTP_TIMEOUT_MS,
      greetingTimeout: env.SMTP_TIMEOUT_MS,
      socketTimeout: env.SMTP_TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true,
      requireTLS: !env.ETHEREAL_SECURE,
    });
    transports.set(key, transport);
  }
  const result = await transport.sendMail({
    from: { name: sender.name, address: sender.email },
    to: email.recipient,
    subject: email.subject,
    text: email.body,
    messageId: `<${email.id}@reachinbox.local>`,
  });
  return {
    messageId: String(result.messageId),
    previewUrl: nodemailer.getTestMessageUrl(result) || null,
  };
}
export function closeTransports() {
  for (const transport of transports.values()) transport.close();
  transports.clear();
}
