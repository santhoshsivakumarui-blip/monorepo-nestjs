import nodemailer, { Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

/** Sends a transactional email through the configured SMTP relay. */
export async function sendEmail(message: MailMessage) {
  const from = process.env.MAIL_FROM_ADDRESS;
  if (!process.env.SMTP_HOST || !from) {
    throw new Error("SMTP_HOST and MAIL_FROM_ADDRESS must be configured");
  }

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM_NAME
      ? `${process.env.MAIL_FROM_NAME} <${from}>`
      : from,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
