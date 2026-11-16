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
export function dueDate(dueAt: string, language: RequestLanguage) {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) throw new Error("A scheduled deletion email needs its due time.");
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

type Copy = { readonly subject: string; readonly paragraphs: readonly string[]; readonly action?: string };

function copyOf(template: AccountEmailTemplate, language: RequestLanguage, parameters: AccountEmailParameters): Copy {
  const ko = language === "ko";

  switch (template) {
    case "account_deletion_scheduled": {
      const date = dueDate(parameters.dueAt ?? "", language);
      return ko
        ? {
            action: "로그인해서 계정 유지하기",
            paragraphs: [
              `요청하신 대로 Find Me a Time 계정이 ${date}에 삭제됩니다.`,
              "그 전에 Google로 다시 로그인하면 삭제가 취소됩니다. 삭제되면 설정, 요청과 대화, Google 연결이 모두 지워지고 되돌릴 수 없습니다. 진행 중인 요청은 닫히고 게스트에게 알립니다. 이미 캘린더에 있는 일정은 그대로 남으니, 원하지 않는 미팅은 그 전에 취소해 주세요.",
              "직접 요청하지 않으셨다면 로그인해서 취소하고 support@findmeatime.com으로 알려 주세요.",
            ],
            subject: "계정 삭제가 예약되었습니다",
          }
        : {
            action: "Sign in to keep my account",
            paragraphs: [
              `As you asked, your Find Me a Time account will be deleted on ${date}.`,
              "Signing in with Google before then cancels it. Once it runs, your settings, requests, conversations and Google connection are deleted and cannot be recovered. Open requests are closed and their guests told. Meetings already in a calendar stay there, so cancel any you no longer want before then.",
              "If you did not ask for this, sign in to cancel it and tell us at support@findmeatime.com.",
            ],
            subject: "Your account is scheduled for deletion",
          };
    }
    case "account_deletion_cancelled":
      return ko
        ? {
            action: "Find Me a Time 열기",
            paragraphs: [
              "다시 로그인하셔서 예약된 계정 삭제를 취소했습니다. 계정과 설정은 그대로입니다.",
              "계정을 삭제하려면 설정에서 다시 요청해 주세요. 직접 로그인하지 않으셨다면 support@findmeatime.com으로 알려 주세요.",
            ],
            subject: "계정 삭제가 취소되었습니다",
          }
        : {
            action: "Open Find Me a Time",
            paragraphs: [
              "You signed in again, so the scheduled deletion of your account is cancelled. Your account and settings are unchanged.",
              "To delete your account, ask again from Settings. If you did not sign in, tell us at support@findmeatime.com.",
            ],
            subject: "Your account deletion is cancelled",
          };
    case "account_deletion_completed":
      return ko
        ? {
            paragraphs: [
              "요청하신 대로 Find Me a Time 계정을 삭제했습니다. 설정, 요청과 대화, Google 연결이 지워졌고, 다른 사람이 쓰지 못하도록 쓰시던 핸들만 남겼습니다.",
              "이미 캘린더에 있는 일정과 본인 메일함의 이메일은 지워지지 않습니다. 같은 Google 계정으로 다시 로그인하면 빈 새 계정이 만들어집니다.",
            ],
            subject: "계정이 삭제되었습니다",
          }
        : {
            paragraphs: [
              "As you asked, your Find Me a Time account is deleted: its settings, requests, conversations and Google connection are gone. We keep only the handle you used, so that nobody else can take it over.",
              "Events already in a calendar and emails in your own mailbox are not removed. Signing in again with the same Google account starts a new, empty account.",
            ],
            subject: "Your account is deleted",
          };
    case "host_account_closed": {
      const host = parameters.hostName || (ko ? "호스트" : "Your host");
      return ko
        ? {
            paragraphs: [
              `${host}님이 Find Me a Time 계정을 닫아서 진행 중이던 미팅 요청이 닫히고 삭제되었습니다. 예약 링크도 더 이상 열리지 않습니다.`,
              "미팅이 아직 필요하다면 호스트에게 직접 연락해 주세요.",
            ],
            subject: `${host}님과의 미팅 요청이 닫혔습니다`,
          }
        : {
            paragraphs: [
              `${host} closed their Find Me a Time account, so your open meeting request with them is closed and deleted, and its booking link no longer opens.`,
              "If you still need the meeting, contact them directly.",
            ],
            subject: `Your meeting request with ${parameters.hostName || "your host"} is closed`,
          };
    }
  }
}

export function renderAccountEmail(
  template: AccountEmailTemplate,
  language: RequestLanguage,
  parameters: AccountEmailParameters,
): Rendered {
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
