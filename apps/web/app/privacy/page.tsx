import type { Metadata } from "next";

// The public data notice, P11 (data-stewardship: public data notice;
// operations-and-release design 10 and 11, D11 and D12): what each audience's
// data is used for, who processes it, how long it is kept, deletion on request
// and the support contact, in English and in Korean (?lang=ko). It states only
// what the code does; change it together with the retention rules in
// supabase/schemas/app/functions/cleanup_retained_records.sql.
export const metadata: Metadata = {
  description: "How Find Me a Time uses, keeps and deletes the data of hosts and the people who book with them.",
  title: "Privacy and your data",
};

const SUPPORT_ADDRESS = "support@findmeatime.com";

type Section = { readonly id: string; readonly title: string; readonly paragraphs: readonly string[]; readonly items?: readonly string[] };

type Notice = {
  readonly lang: "en" | "ko";
  readonly title: string;
  readonly updated: string;
  readonly intro: string;
  readonly other: { readonly href: string; readonly label: string };
  readonly sections: readonly Section[];
};

const EN: Notice = {
  intro:
    "Find Me a Time schedules external one-to-one meetings for hosts who sign in with Google. People who book with a host do not need an account. This page says what we collect, why, who processes it, how long we keep it and how to have it deleted.",
  lang: "en",
  other: { href: "/privacy?lang=ko", label: "한국어" },
  sections: [
    {
      id: "who",
      paragraphs: [
        `Find Me a Time is run by SNU SWPP 2026 Team 01. Write to ${SUPPORT_ADDRESS} with any question or request about your data; we answer within two working days.`,
      ],
      title: "Who we are",
    },
    {
      id: "hosts",
      items: [
        "Your Google identity (name, email address and Google account ID) to sign you in.",
        "Access to the Google calendars you select, to suggest your scheduling rules, find free times and create the booked event in your calendar. We read event times, busy status and locations of the calendars you choose; the analysis behind suggestions is deleted after 24 hours.",
        "The settings you confirm, your public handle, the requests made to you and your conversations with the assistant.",
        "If you link them: the iMessage address you link, and the personal agents you connect.",
      ],
      paragraphs: ["When you become a host we collect:"],
      title: "Hosts",
    },
    {
      id: "requesters",
      items: [
        "Your name and email address, to send you the booking link and the meeting's status.",
        "The details of your request and your conversation with the assistant.",
        "If you choose Continue with Google: your Google name and email, and, only if you allow it, read-only access to your calendar's busy times.",
        "If you write by email: the messages in your email thread with the service.",
      ],
      paragraphs: ["When you ask a host for a meeting we collect:"],
      title: "People who book with a host",
    },
    {
      id: "calendar",
      paragraphs: [
        "Calendar access is used only to schedule the meetings you ask for. A host's private events, rules and notes are never shown to the person booking, and a requester's calendar is never shown to the host: each side sees only the times offered and the meeting agreed.",
        "A requester's calendar access lasts only for one request and is deleted when the request closes, when its link expires or when you choose Disconnect. A host can disconnect Google at any time.",
      ],
      title: "How we use your calendar",
    },
    {
      id: "processors",
      items: [
        "Supabase (database and sign-in) and Vercel (hosting), in the United States.",
        "OpenAI, which runs the assistant. We call it with storage turned off; under OpenAI's API terms the data is not used to train models, and OpenAI may keep it for up to 30 days to monitor abuse. We have no zero-retention agreement with OpenAI.",
        "Google, for sign-in and Calendar.",
        "Cloudflare, which sends our transactional email from no-reply@findmeatime.com and runs our domain.",
        "AgentMail, which holds the email threads of requests made by email, and Photon, which carries a host's iMessage conversation.",
      ],
      paragraphs: [
        "These providers process data for us. The assistant sees only what the person it is talking to may see, with booking links and codes removed first.",
      ],
      title: "Who processes your data",
    },
    {
      id: "retention",
      items: [
        "A closed request (booked, declined, withdrawn or expired) and everything under it, including the conversation: deleted 90 days after it closed.",
        "A draft started on a host's page and never completed: deleted after 24 hours.",
        "Email threads and iMessage records: deleted after 30 days.",
        "Records that prevent duplicate actions and enforce limits: deleted after 30 days; spending records of the assistant after 90 days.",
        "A host's account and settings: kept until the host asks us to delete them.",
      ],
      paragraphs: [
        "Copies outside our database are not removed by these rules: the event in a host's calendar, emails in your own mailbox, threads in AgentMail, messages on your phone, OpenAI's abuse-monitoring logs, and the conversation runtime's own session record at our host.",
      ],
      title: "How long we keep it",
    },
    {
      id: "deletion",
      paragraphs: [
        `Write to ${SUPPORT_ADDRESS} from the address you use with us. For a host we delete the account's data, its Google connection and its sign-in; we keep only the handle you used so that nobody else can take it over. For a request we delete the request and its conversation. We do not touch events already in a calendar.`,
      ],
      title: "Deleting your data",
    },
    {
      id: "never",
      paragraphs: ["We do not sell data, show ads, or use your data to train AI models. Nothing is booked without the host's explicit approval."],
      title: "What we never do",
    },
  ],
  title: "Privacy and your data",
  updated: "Last updated 2026-10-23",
};

const KO: Notice = {
  intro:
    "Find Me a Time은 Google로 로그인한 호스트를 위해 외부 1:1 미팅 일정을 잡아 줍니다. 호스트와 미팅을 잡는 분은 계정이 필요 없습니다. 이 페이지는 무엇을 왜 수집하는지, 누가 처리하는지, 얼마나 보관하는지, 어떻게 삭제를 요청하는지 설명합니다.",
  lang: "ko",
  other: { href: "/privacy", label: "English" },
  sections: [
    {
      id: "who",
      paragraphs: [`Find Me a Time은 SNU SWPP 2026 Team 01이 운영합니다. 데이터에 관한 질문이나 요청은 ${SUPPORT_ADDRESS}로 보내 주세요. 영업일 기준 2일 안에 답합니다.`],
      title: "운영자",
    },
    {
      id: "hosts",
      items: [
        "로그인을 위한 Google 신원(이름, 이메일 주소, Google 계정 ID).",
        "선택한 Google 캘린더에 대한 접근 권한. 일정 규칙을 제안하고, 빈 시간을 찾고, 확정된 일정을 캘린더에 만드는 데 씁니다. 선택한 캘린더의 일정 시간, 바쁨 여부, 장소를 읽으며, 제안에 쓴 분석은 24시간 뒤 삭제합니다.",
        "확인한 설정, 공개 핸들, 받은 요청, 어시스턴트와의 대화.",
        "연결한 경우: 연결한 iMessage 주소와 연결한 개인 에이전트.",
      ],
      paragraphs: ["호스트가 되면 다음을 수집합니다."],
      title: "호스트",
    },
    {
      id: "requesters",
      items: [
        "예약 링크와 미팅 상태를 보내기 위한 이름과 이메일 주소.",
        "요청 내용과 어시스턴트와의 대화.",
        "Continue with Google을 선택한 경우: Google 이름과 이메일, 그리고 허용한 경우에만 캘린더 바쁨 시간에 대한 읽기 전용 접근.",
        "이메일로 요청한 경우: 서비스와 주고받은 이메일 스레드의 메시지.",
      ],
      paragraphs: ["호스트에게 미팅을 요청하면 다음을 수집합니다."],
      title: "호스트와 미팅을 잡는 분",
    },
    {
      id: "calendar",
      paragraphs: [
        "캘린더 접근은 요청한 미팅의 일정을 잡는 데만 씁니다. 호스트의 비공개 일정, 규칙, 메모는 미팅을 요청한 분에게 보이지 않고, 요청한 분의 캘린더도 호스트에게 보이지 않습니다. 양쪽 모두 제안된 시간과 합의된 미팅만 봅니다.",
        "요청한 분의 캘린더 접근은 한 요청에만 유효하며, 요청이 닫히거나 링크가 만료되거나 Disconnect를 누르면 삭제합니다. 호스트는 언제든 Google 연결을 끊을 수 있습니다.",
      ],
      title: "캘린더를 쓰는 방식",
    },
    {
      id: "processors",
      items: [
        "Supabase(데이터베이스와 로그인), Vercel(호스팅). 미국에 있습니다.",
        "어시스턴트를 실행하는 OpenAI. 저장을 끈 상태로 호출하며, OpenAI API 약관에 따라 모델 학습에 쓰이지 않습니다. OpenAI는 남용 감시를 위해 최대 30일 보관할 수 있습니다. OpenAI와 무보관 계약은 맺지 않았습니다.",
        "로그인과 캘린더를 위한 Google.",
        "no-reply@findmeatime.com에서 거래 이메일을 보내고 도메인을 운영하는 Cloudflare.",
        "이메일로 시작한 요청의 스레드를 보관하는 AgentMail, 호스트의 iMessage 대화를 전달하는 Photon.",
      ],
      paragraphs: ["다음 업체가 저희를 대신해 데이터를 처리합니다. 어시스턴트는 대화 상대가 볼 수 있는 내용만 보며, 예약 링크와 코드는 먼저 지웁니다."],
      title: "데이터를 처리하는 곳",
    },
    {
      id: "retention",
      items: [
        "닫힌 요청(확정, 거절, 철회, 만료)과 대화를 포함한 그 아래 모든 기록: 닫힌 뒤 90일이 지나면 삭제합니다.",
        "호스트 페이지에서 시작했지만 완성하지 않은 초안: 24시간 뒤 삭제합니다.",
        "이메일 스레드와 iMessage 기록: 30일 뒤 삭제합니다.",
        "중복 동작을 막고 한도를 지키기 위한 기록: 30일 뒤, 어시스턴트 비용 기록은 90일 뒤 삭제합니다.",
        "호스트 계정과 설정: 호스트가 삭제를 요청할 때까지 보관합니다.",
      ],
      paragraphs: [
        "저희 데이터베이스 밖의 사본은 이 규칙으로 지워지지 않습니다: 호스트 캘린더의 일정, 본인 메일함의 이메일, AgentMail의 스레드, 휴대폰의 메시지, OpenAI의 남용 감시 기록, 호스팅 업체에 있는 대화 런타임의 세션 기록.",
      ],
      title: "보관 기간",
    },
    {
      id: "deletion",
      paragraphs: [
        `저희와 쓰는 주소에서 ${SUPPORT_ADDRESS}로 요청해 주세요. 호스트의 경우 계정 데이터, Google 연결, 로그인을 삭제하며, 다른 사람이 가져가지 못하도록 쓰던 핸들만 남깁니다. 요청의 경우 요청과 그 대화를 삭제합니다. 이미 캘린더에 있는 일정은 건드리지 않습니다.`,
      ],
      title: "데이터 삭제",
    },
    {
      id: "never",
      paragraphs: ["데이터를 판매하거나 광고를 보여 주거나 AI 모델 학습에 쓰지 않습니다. 호스트가 명시적으로 승인하지 않으면 아무것도 예약되지 않습니다."],
      title: "하지 않는 일",
    },
  ],
  title: "개인정보와 데이터",
  updated: "최종 수정 2026-10-23",
};

export default async function Page({ searchParams }: { readonly searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  const notice = lang === "ko" ? KO : EN;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 sm:px-8" lang={notice.lang}>
      <header className="flex flex-col gap-3">
        <p className="text-sm">
          <a className="underline underline-offset-4" href="/">
            Find Me a Time
          </a>
          {" · "}
          <a className="underline underline-offset-4" href={notice.other.href} hrefLang={notice.lang === "en" ? "ko" : "en"}>
            {notice.other.label}
          </a>
        </p>
        <h1 className="font-display text-[clamp(32px,5vw,48px)] leading-tight">{notice.title}</h1>
        <p className="text-muted-foreground text-sm">{notice.updated}</p>
        <p className="text-lg">{notice.intro}</p>
      </header>
      {notice.sections.map((section) => (
        <section aria-labelledby={`${section.id}-heading`} className="flex scroll-mt-8 flex-col gap-3" id={section.id} key={section.id}>
          <h2 className="font-display text-2xl" id={`${section.id}-heading`}>
            {section.title}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.items ? (
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </main>
  );
}
