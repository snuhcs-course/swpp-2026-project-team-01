import type { RequestLanguage } from "../contracts/request";

// The account emails of self-service deletion (self-service-account-deletion
// D5): the host is told when their deletion is scheduled, cancelled by a
// sign-in, and run; each open request's guest is told that the host closed their
// account. None carries a link that grants access: the host's link to /app asks
// them to sign in, and the guest's carries no link at all.

export const ACCOUNT_EMAIL_TEMPLATES = [
  "account_deletion_scheduled",
  "account_deletion_cancelled",
  "account_deletion_completed",
  "host_account_closed",
] as const;
export type AccountEmailTemplate = (typeof ACCOUNT_EMAIL_TEMPLATES)[number];

export function isAccountEmailTemplate(value: string): value is AccountEmailTemplate {
  return (ACCOUNT_EMAIL_TEMPLATES as readonly string[]).includes(value);
}

export type AccountEmailParameters = {
  // The account the email is about, which decides whether it is still current.
  readonly hostAccountId: string;
  // The scheduled due time (ISO 8601), on the scheduled email.
  readonly dueAt?: string;
  // The host's /app address, on the host's emails.
  readonly appUrl?: string;
  // The host's public name, on the guest's notice.
  readonly hostName?: string | null;
};

type Rendered = { readonly subject: string; readonly html: string; readonly text: string };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// The due date in UTC, written out so it reads the same in any mail client.
export function dueDate(dueAt: string, _language: RequestLanguage) {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) throw new Error("A scheduled deletion email needs its due time.");
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

type Copy = { readonly subject: string; readonly paragraphs: readonly string[]; readonly action?: string };

function copyOf(template: AccountEmailTemplate, language: RequestLanguage, parameters: AccountEmailParameters): Copy {
  switch (template) {
    case "account_deletion_scheduled": {
      const date = dueDate(parameters.dueAt ?? "", language);
      return {
        action: "Sign in to keep my account",
        paragraphs: [
          `Your Find Me a Time account is scheduled for deletion on ${date}.`,
          "Sign in with Google before then to cancel deletion. When deletion runs, your settings, requests, conversations and Google connection are permanently deleted. Open requests are closed and their guests notified. Events already on your calendar stay there, so cancel any you no longer want before the deletion date.",
          "If you did not request deletion, sign in to cancel it and contact support@findmeatime.com.",
        ],
        subject: "Your account is scheduled for deletion",
      };
    }
    case "account_deletion_cancelled":
      return {
        action: "Open Find Me a Time",
        paragraphs: [
          "Your account deletion was cancelled when you signed in again. Your account and settings are still available.",
          "To delete your account, request it again from Settings. If you did not sign in, contact support@findmeatime.com.",
        ],
        subject: "Your account deletion was cancelled",
      };
    case "account_deletion_completed":
      return {
        paragraphs: [
          "Your Find Me a Time account has been deleted. Your settings, requests, conversations and Google connection are gone. We keep your handle so nobody else can claim it.",
          "Events already on a calendar and messages in your mailbox are not deleted. If you sign in again with the same Google account, you will start with a new, empty account.",
        ],
        subject: "Your account has been deleted",
      };
    case "host_account_closed": {
      const host = parameters.hostName || "Your host";
      return {
        paragraphs: [
          `${host} closed their Find Me a Time account. Your open request with them is closed, and its private link no longer works.`,
          "If you still need to meet, contact them directly.",
        ],
        subject: parameters.hostName ? `Your request with ${host} is closed` : "Your meeting request is closed",
      };
    }
  }
}

export function renderAccountEmail(
  template: AccountEmailTemplate,
  _language: RequestLanguage,
  parameters: AccountEmailParameters,
): Rendered {
  const language: RequestLanguage = "en";
  const copy = copyOf(template, language, parameters);
  const link = copy.action && parameters.appUrl ? { label: copy.action, url: parameters.appUrl } : null;
  const html = [
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeHtml(copy.subject)}</title></head>`,
    `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">`,
    ...copy.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(link
      ? [
          `<p style="margin:24px 0"><a href="${escapeHtml(link.url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(link.label)}</a></p>`,
        ]
      : []),
    `<p style="color:#555;font-size:14px">Find Me a Time</p>`,
    `</body></html>`,
  ].join("");
  const text = [
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(link ? [`${link.label}: ${link.url}`, ""] : []),
    "Find Me a Time",
  ].join("\n");

  return { html, subject: copy.subject, text };
}
