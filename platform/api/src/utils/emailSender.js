import nodemailer from "nodemailer";
import { config } from "../config.js";

let cachedTransporter = null;
let cachedKey = "";

export function isEmailConfigured(smtp = config.smtp) {
  if (smtp.transport === "json" || smtp.transport === "stream") return true;
  return Boolean(smtp.host && smtp.from);
}

export function createEmailTransporter(smtp = config.smtp) {
  if (smtp.transport === "json") {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (smtp.transport === "stream") {
    return nodemailer.createTransport({
      streamTransport: true,
      newline: "unix",
      buffer: true,
    });
  }

  if (!isEmailConfigured(smtp)) {
    return null;
  }

  const auth = smtp.user || smtp.pass
    ? { user: smtp.user, pass: smtp.pass }
    : undefined;

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth,
  });
}

function transporterKey(smtp = config.smtp) {
  return JSON.stringify({
    transport: smtp.transport,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user,
    from: smtp.from,
  });
}

export function getEmailTransporter(smtp = config.smtp) {
  const key = transporterKey(smtp);
  if (!cachedTransporter || cachedKey !== key) {
    cachedTransporter = createEmailTransporter(smtp);
    cachedKey = key;
  }
  return cachedTransporter;
}

export async function sendTransactionalEmail({
  to,
  subject,
  text,
  html,
  replyTo,
}, smtp = config.smtp) {
  const transporter = getEmailTransporter(smtp);
  if (!transporter) {
    const err = new Error("Email non configurata.");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  return transporter.sendMail({
    from: smtp.from,
    to,
    replyTo,
    subject,
    text,
    html,
  });
}
