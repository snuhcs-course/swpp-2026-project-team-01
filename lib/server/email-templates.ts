import type { RequestLanguage } from "../contracts/request";
import {
  ACCOUNT_EMAIL_TEMPLATES,
  type AccountEmailParameters,
  isAccountEmailTemplate,
  renderAccountEmail,
} from "./account-emails";
import {
  BOOKING_EMAIL_TEMPLATES,
  type BookingEmailParameters,
  isBookingEmailTemplate,
  renderBookingEmail,
} from "./booking-emails";

// The transactional email templates use English copy and render as HTML with
// a plain-text alternative. Templates render at dispatch from the
// delivery's frozen non-secret parameters and its sealed secret parameters (the
// booking link and the confirmation link), so neither link is stored usable.

export const EMAIL_TEMPLATES = [
  "request_creation",
  "link_resend",
  ...BOOKING_EMAIL_TEMPLATES,
  ...ACCOUNT_EMAIL_TEMPLATES,
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export function isEmailTemplate(value: string): value is EmailTemplate {
  return (EMAIL_TEMPLATES as readonly string[]).includes(value);
}

type RequestEmailParameters = {
  // The host's public display name.
  readonly hostName?: string;
  readonly requesterName?: string;
};

export type EmailParameters =
  | RequestEmailParameters
  | BookingEmailParameters
  | AccountEmailParameters;

export type EmailSecrets = {
  // Absent only on the host's copy of a booking email, which links to /app.
  readonly bookingUrl?: string;
  // Present only on a creation email whose address is not already confirmed.
  readonly confirmUrl?: string;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Copy = {
  readonly subject: string;
  readonly preheader: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly bookingAction: string;
  readonly confirm?: { readonly title: string; readonly lead: string; readonly action: string };
  readonly footer: string;
};

const FALLBACK_HOST = "your host";

function creationCopy(parameters: RequestEmailParameters, confirm: boolean): Copy {
  const host = parameters.hostName || FALLBACK_HOST;
  const name = parameters.requesterName;

  return {
    bookingAction: "Continue my request",
    confirm: confirm
      ? {
          action: "Confirm email address",
          lead: "Confirm this address if it is yours. This step is optional, and scheduling will continue without it.",
          title: "Optional email confirmation",
        }
      : undefined,
    eyebrow: "MEETING REQUEST",
    footer: "This private link opens your request. Keep it to yourself. If you did not start this request, you can ignore this email.",
    greeting: name ? `Hi ${name},` : "Hi,",
    paragraphs: [
      `Your request to meet with ${host} is open. Continue the conversation and coordinate a time using your private link. The meeting is not booked until a time is confirmed.`,
    ],
    preheader: "Your request is open. Continue the conversation and coordinate a time.",
    subject: confirm
      ? `Confirm your email address for your meeting request with ${host}`
      : `Continue your meeting request with ${host}`,
    title: "Continue your meeting request",
  };
}

function resendCopy(parameters: RequestEmailParameters): Copy {
  const host = parameters.hostName || FALLBACK_HOST;

  return {
    bookingAction: "Continue my request",
    eyebrow: "YOUR BOOKING LINK",
    footer: "This private link opens your request. Keep it to yourself. If you did not ask for this email, you can ignore it.",
    greeting: "Hi,",
    paragraphs: [
      `As requested, here is the private link to continue your request to meet with ${host}. The meeting is not booked until a time is confirmed.`,
    ],
    preheader: "Continue your meeting request with your private link.",
    subject: `Your booking link for your meeting with ${host}`,
    title: "Continue your meeting request",
  };
}

function button(url: string, label: string, variant: "primary" | "secondary") {
  const primary = variant === "primary";
  const background = primary ? "#2C3E63" : "#FFFFFF";
  const color = primary ? "#FFFFFF" : "#2C3E63";
  const border = primary ? "1px solid #2C3E63" : "1px solid #7B8BA8";
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0">`,
    `<tr><td bgcolor="${background}" style="background-color:${background};border:${border};border-radius:10px;text-align:center">`,
    `<a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;color:${color};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none">${escapeHtml(label)}</a>`,
    `</td></tr></table>`,
  ].join("");
}

function render(language: RequestLanguage, copy: Copy, secrets: EmailSecrets & { readonly bookingUrl: string }): RenderedEmail {
  const html = [
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(copy.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background-color:#F6F7F9;color:#1E2430;font-family:Arial,Helvetica,sans-serif;line-height:1.6">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(copy.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F6F7F9" style="width:100%;border-collapse:collapse;background-color:#F6F7F9"><tr><td align="center" style="padding:32px 16px">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse">`,
    `<tr><td style="padding:0 8px 18px;color:#2C3E63;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1.2">Find Me a Time</td></tr>`,
    `<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #D4D9E2;border-top:4px solid #2C3E63;border-radius:16px;padding:34px 36px 30px">`,
    `<p style="margin:0 0 12px;color:#586172;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;line-height:16px">${escapeHtml(copy.eyebrow)}</p>`,
    `<h1 style="margin:0 0 18px;color:#1E2430;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;line-height:1.2">${escapeHtml(copy.title)}</h1>`,
    `<p style="margin:0 0 14px;color:#1E2430;font-size:16px;line-height:24px">${escapeHtml(copy.greeting)}</p>`,
    ...copy.paragraphs.map((paragraph) => `<p style="margin:0 0 18px;color:#3E444E;font-size:15px;line-height:24px">${escapeHtml(paragraph)}</p>`),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td>${button(secrets.bookingUrl, copy.bookingAction, "primary")}</td></tr></table>`,
    ...(copy.confirm && secrets.confirmUrl
      ? [
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F6F7F9" style="width:100%;margin-top:28px;border-collapse:separate;background-color:#F6F7F9;border:1px solid #D4D9E2;border-radius:12px"><tr><td style="padding:20px 20px 18px">`,
          `<p style="margin:0 0 7px;color:#2C3E63;font-size:13px;font-weight:700;line-height:19px">${escapeHtml(copy.confirm.title)}</p>`,
          `<p style="margin:0 0 16px;color:#586172;font-size:13px;line-height:20px">${escapeHtml(copy.confirm.lead)}</p>`,
          button(secrets.confirmUrl, copy.confirm.action, "secondary"),
          `</td></tr></table>`,
        ]
      : []),
    `<p style="margin:26px 0 0;color:#586172;font-size:12px;line-height:19px">${escapeHtml(copy.footer)}</p>`,
    `</td></tr>`,
    `</table></td></tr></table>`,
    `</body></html>`,
  ].join("");
  const text = [
    copy.greeting,
    "",
    copy.title,
    "",
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${copy.bookingAction}: ${secrets.bookingUrl}`,
    "",
    ...(copy.confirm && secrets.confirmUrl ? [copy.confirm.title, copy.confirm.lead, `${copy.confirm.action}: ${secrets.confirmUrl}`, ""] : []),
    copy.footer,
    "",
    "Find Me a Time",
  ].join("\n");

  return { html, subject: copy.subject, text };
}

export function renderEmail(
  template: EmailTemplate,
  language: RequestLanguage,
  parameters: EmailParameters,
  secrets: EmailSecrets,
): RenderedEmail {
  if (isAccountEmailTemplate(template)) {
    return renderAccountEmail(template, language, parameters as AccountEmailParameters);
  }

  if (isBookingEmailTemplate(template)) {
    return renderBookingEmail(template, language, parameters as BookingEmailParameters, secrets);
  }

  const request = parameters as RequestEmailParameters;
  const copy =
    template === "request_creation"
      ? creationCopy(request, Boolean(secrets.confirmUrl))
      : resendCopy(request);

  if (!secrets.bookingUrl) throw new Error("A request email needs its booking link.");
  return render("en", copy, { ...secrets, bookingUrl: secrets.bookingUrl });
}
