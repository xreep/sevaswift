import nodemailer from 'nodemailer';
import { config } from '../../config/index';

const transport = config.mail.smtpUrl ? nodemailer.createTransport(config.mail.smtpUrl) : null;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends a transactional email over SMTP when SMTP_URL is configured. Without
 * it the message is written to the log (outside tests) so links stay usable
 * in development and demos. Never throws: a mail failure must not fail the request.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  if (!transport) {
    if (config.nodeEnv !== 'test') {
      console.warn(`[mail] To ${message.to} — ${message.subject}\n${message.text}`);
    }
    return;
  }
  try {
    await transport.sendMail({ from: config.mail.from, ...message });
  } catch (err) {
    console.error(`[mail] Failed to send "${message.subject}" to ${message.to}:`, err);
  }
}
