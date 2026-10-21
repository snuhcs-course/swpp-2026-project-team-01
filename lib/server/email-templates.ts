import type { RequestLanguage } from "../contracts/request";

// The transactional email templates, in English and Korean, each rendered as
// HTML with a plain-text alternative. Templates render at dispatch from the
// delivery's frozen non-secret parameters and its sealed secret parameters (the
// booking link and the confirmation link), so neither link is stored usable.

export const EMAIL_TEMPLATES = ["request_creation", "link_resend"] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export function isEmailTemplate(value: string): value is EmailTemplate {
  return (EMAIL_TEMPLATES as readonly string[]).includes(value);
}

export type EmailParameters = {
  // The host's public display name.
  readonly hostName?: string;
  readonly requesterName?: string;
};

export type EmailSecrets = {
  readonly bookingUrl: string;
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
  readonly greeting: string;
  readonly paragraphs: readonly string[];
  readonly bookingAction: string;
  readonly confirm?: { readonly lead: string; readonly action: string };
  readonly footer: string;
};

const FALLBACK_HOST = { en: "your host", ko: "호스트" } as const;

function creationCopy(language: RequestLanguage, parameters: EmailParameters, confirm: boolean): Copy {
  const host = parameters.hostName || FALLBACK_HOST[language];
  const name = parameters.requesterName;

  if (language === "ko") {
    return {
      bookingAction: "내 예약 요청 열기",
      confirm: confirm
        ? { action: "이 주소 확인하기", lead: "이 이메일 주소가 맞다면 확인해 주세요. 확인하지 않아도 일정 조율은 계속됩니다." }
        : undefined,
      footer: "이 링크는 요청을 여는 유일한 수단이니 다른 사람과 공유하지 마세요. 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.",
      greeting: name ? `${name}님, 안녕하세요.` : "안녕하세요.",
      paragraphs: [`${host}님과의 미팅 요청이 만들어졌습니다. 아래 링크에서 언제든 요청을 이어갈 수 있습니다.`],
      subject: `${host}님과의 미팅 요청`,
    };
  }

  return {
    bookingAction: "Open my booking request",
    confirm: confirm
      ? {
          action: "Confirm this address",
          lead: "If this is your address, please confirm it. Scheduling goes ahead whether or not you do.",
        }
      : undefined,
    footer:
      "This link is the only way into your request, so keep it to yourself. If you did not ask for a meeting, you can ignore this email.",
    greeting: name ? `Hi ${name},` : "Hi,",
    paragraphs: [`Your meeting request with ${host} is ready. You can pick it up at any time from the link below.`],
    subject: `Your meeting request with ${host}`,
  };
}

function resendCopy(language: RequestLanguage, parameters: EmailParameters): Copy {
  const host = parameters.hostName || FALLBACK_HOST[language];

  if (language === "ko") {
    return {
      bookingAction: "내 예약 요청 열기",
      footer: "이 링크는 요청을 여는 유일한 수단이니 다른 사람과 공유하지 마세요. 다시 보내기를 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다.",
      greeting: "안녕하세요.",
      paragraphs: [`요청하신 대로 ${host}님과의 미팅 요청 링크를 다시 보내 드립니다.`],
      subject: `${host}님과의 미팅 요청 링크`,
    };
  }

  return {
    bookingAction: "Open my booking request",
    footer:
      "This link is the only way into your request, so keep it to yourself. If you did not ask for it again, you can ignore this email.",
    greeting: "Hi,",
    paragraphs: [`Here is the link to your meeting request with ${host}, as you asked.`],
    subject: `Your booking link for your meeting with ${host}`,
  };
}

function button(url: string, label: string) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function render(language: RequestLanguage, copy: Copy, secrets: EmailSecrets): RenderedEmail {
  const html = [
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeHtml(copy.subject)}</title></head>`,
    `<body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">`,
    `<p>${escapeHtml(copy.greeting)}</p>`,
    ...copy.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    button(secrets.bookingUrl, copy.bookingAction),
    ...(copy.confirm && secrets.confirmUrl
      ? [`<p>${escapeHtml(copy.confirm.lead)}</p>`, button(secrets.confirmUrl, copy.confirm.action)]
      : []),
    `<p style="color:#555;font-size:14px">${escapeHtml(copy.footer)}</p>`,
    `<p style="color:#555;font-size:14px">Find Me a Time</p>`,
    `</body></html>`,
  ].join("");
  const text = [
    copy.greeting,
    "",
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${copy.bookingAction}: ${secrets.bookingUrl}`,
    "",
    ...(copy.confirm && secrets.confirmUrl ? [copy.confirm.lead, `${copy.confirm.action}: ${secrets.confirmUrl}`, ""] : []),
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
  const copy =
    template === "request_creation"
      ? creationCopy(language, parameters, Boolean(secrets.confirmUrl))
      : resendCopy(language, parameters);

  return render(language, copy, secrets);
}
