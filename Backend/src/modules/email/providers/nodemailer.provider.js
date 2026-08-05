const nodemailer = require("nodemailer");

// SMTP provider backed by nodemailer. This is the only file in the codebase
// that should ever import "nodemailer" directly — everything else talks to
// the provider through the send()/isConfigured() interface below, so a
// future provider (SendGrid, SES, Postmark, ...) is a drop-in replacement
// that implements the same two functions.
let transporter = null;
let initialized = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

function getTransporter() {
  if (initialized) return transporter;
  initialized = true;
  if (!isConfigured()) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * @param {{ to: string, subject: string, html: string, text: string, from?: string, cc?: string[], attachments?: {filename:string, content:string|Buffer, contentType?:string}[] }} message
 * @returns {Promise<{ messageId: string }>}
 */
async function send({ to, subject, html, text, from, cc, attachments }) {
  const client = getTransporter();
  if (!client) {
    const error = new Error("SMTP is not configured (missing SMTP_HOST/SMTP_PORT)");
    error.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  const info = await client.sendMail({
    from: from || process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    cc: cc?.length ? cc : undefined,
    subject,
    html,
    text,
    attachments: attachments?.length ? attachments : undefined,
  });
  return { messageId: info?.messageId };
}

module.exports = { name: "smtp", send, isConfigured };
