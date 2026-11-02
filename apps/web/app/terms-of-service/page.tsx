import type { Metadata } from "next";
import { type LegalDocument, LegalPage, type LegalSearchParams } from "../_components/legal-document";

// The terms of service, P12 (data-stewardship: terms of service;
// operations-and-release design 11, D12): what the service does, what hosts,
// requesters and their agents are responsible for, acceptable use, and the
// limits of what the team promises, in English and in Korean (?lang=ko). Like
// the data notice it states only what the code does: approval-only booking, no
// rescheduling after booking, booking links as credentials, the sign-up, handle
// and assistant limits, and the operator's suspend and delete commands. Fees,
// governing law and a minimum age are the team's decisions and are not stated.
export const metadata: Metadata = {
  description: "The terms for using Find Me a Time as a host, as someone who books with a host, or through an AI agent.",
  title: "Terms of service",
};

const SUPPORT_ADDRESS = "support@findmeatime.com";

const EN: LegalDocument = {
  intro:
    "These terms apply when you use Find Me a Time at findmeatime.com, as a host, as someone who books with a host, or through an AI agent. By using the service you accept them. How we handle your data is described in our privacy notice.",
  lang: "en",
  other: { href: "/terms-of-service?lang=ko", label: "한국어" },
  sections: [
    {
      id: "service",
      paragraphs: [
        "Find Me a Time is run by SNU SWPP 2026 Team 01. Its assistant, Thyme, schedules external one-to-one meetings: it gathers the details of a request, finds times that fit the host's Google Calendar and rules, and proposes them.",
        "A meeting is booked only when the host approves the current proposal. Once booked, the event lives in the host's calendar and the service does not reschedule or cancel it: the host changes or cancels it in their calendar, and the person who booked asks the host.",
        "Find Me a Time is a student project: we may change, limit, pause or end any part of it at any time, and we do not promise that it is always available. To keep it available for everyone, we limit sign-ups, handle changes and use of the assistant.",
      ],
      title: "The service",
    },
    {
      id: "hosts",
      items: [
        "Choose a handle that does not impersonate another person or organization. Some names are reserved, a handle can be changed only a limited number of times, and we may suspend a host whose handle misleads people.",
        "Check each proposal's time, length, place and the person you will meet before you approve it.",
        "Keep the settings you confirm accurate: Thyme offers times based on them and on your calendar.",
        "You can disconnect Google, unlink iMessage or revoke an agent at any time, and ask us to delete your account as the privacy notice describes.",
      ],
      paragraphs: [
        "You become a host by signing in with Google. You are responsible for what happens under your account, including through the iMessage address and the personal agents you connect.",
      ],
      title: "Hosts",
    },
    {
      id: "requesters",
      items: [
        "Give your own name and an email address you can read: we send your booking link and the meeting's status there.",
        "Keep your booking link to yourself. Anyone who has it can act on your request.",
        "A request is not a booking. The host may decline it or propose other times, and only the host's approval books a meeting.",
      ],
      paragraphs: ["You do not need an account to ask a host for a meeting."],
      title: "People who book with a host",
    },
    {
      id: "agents",
      paragraphs: [
        "You may use a personal AI agent through the public instructions at findmeatime.com/SKILL.md and the connections they describe. An agent you connect acts only within the permissions you grant on the consent page, and you are responsible for what you ask it to do. An agent cannot approve or decline a meeting on the host's behalf.",
        "Thyme is an AI model and can misunderstand a request or make mistakes. The proposal on screen, the confirmation email and the event in the calendar are the record; check them rather than relying on the conversation alone.",
      ],
      title: "AI agents and the assistant",
    },
    {
      id: "use",
      items: [
        "Send spam or unsolicited bulk requests, or harass, threaten or deceive anyone.",
        "Impersonate a person or organization, or submit someone else's personal data without the right to do so.",
        "Reach requests, calendars, conversations or accounts that are not yours, or get around a permission, limit or security measure.",
        "Probe the service for weaknesses, overload or disrupt it, or access it automatically other than through the published agent instructions and connections.",
        "Break the law or infringe anyone's rights.",
      ],
      paragraphs: ["You may not use the service to do any of the following."],
      title: "Acceptable use",
    },
    {
      id: "content",
      links: [{ href: "/privacy", label: "Privacy and your data" }],
      paragraphs: [
        "You keep the rights to what you send us: your messages, requests and settings. You let us store, process and show them as far as the service needs to schedule the meetings you ask for, as the privacy notice describes; for example, a request's details are shown to the host it is for, and the times offered are shown to the person who asked.",
      ],
      title: "Your content",
    },
    {
      id: "ending",
      paragraphs: [
        `We may limit, suspend or end access for anyone who breaks these terms or puts other people or the service at risk, including by suspending a host account or deleting a request. You may stop using the service at any time; to have your data deleted, write to ${SUPPORT_ADDRESS}.`,
      ],
      title: "Suspension and ending",
    },
    {
      id: "liability",
      paragraphs: [
        "The service is provided as is and as available, without warranties of any kind, to the extent the law allows. Except where the law does not allow it, we are not responsible for a meeting that is missed, mistimed or never booked, for a calendar event changed outside the service, or for indirect or consequential loss arising from use of the service.",
      ],
      title: "Warranties and liability",
    },
    {
      id: "changes",
      paragraphs: [
        "We may update these terms; when we do, we change the date at the top of this page. If you keep using the service after a change, the updated terms apply.",
      ],
      title: "Changes to these terms",
    },
    {
      id: "contact",
      paragraphs: [`Questions about these terms go to ${SUPPORT_ADDRESS}.`],
      title: "Contact",
    },
  ],
  title: "Terms of service",
  updated: "Last updated 2026-11-02",
};

const KO: LegalDocument = {
  intro:
    "이 약관은 호스트로, 호스트와 미팅을 잡는 분으로, 또는 AI 에이전트를 통해 findmeatime.com의 Find Me a Time을 이용할 때 적용됩니다. 서비스를 이용하면 이 약관에 동의하는 것입니다. 데이터를 다루는 방식은 개인정보 안내에서 설명합니다.",
  lang: "ko",
  other: { href: "/terms-of-service", label: "English" },
  sections: [
    {
      id: "service",
      paragraphs: [
        "Find Me a Time은 SNU SWPP 2026 Team 01이 운영합니다. 어시스턴트 Thyme이 외부 1:1 미팅 일정을 잡습니다. 요청의 세부 내용을 모으고, 호스트의 Google 캘린더와 규칙에 맞는 시간을 찾아 제안합니다.",
        "미팅은 호스트가 현재 제안을 승인할 때만 예약됩니다. 예약된 일정은 호스트의 캘린더에 있으며, 서비스는 그 일정을 바꾸거나 취소하지 않습니다. 호스트는 캘린더에서 바꾸거나 취소하고, 미팅을 잡은 분은 호스트에게 요청해 주세요.",
        "Find Me a Time은 학생 프로젝트이므로 언제든 일부나 전부를 바꾸거나 제한하거나 멈추거나 끝낼 수 있으며, 항상 이용할 수 있다고 약속하지 않습니다. 모두가 쓸 수 있도록 가입, 핸들 변경, 어시스턴트 사용량을 제한합니다.",
      ],
      title: "서비스",
    },
    {
      id: "hosts",
      items: [
        "다른 사람이나 단체를 사칭하지 않는 핸들을 고르세요. 일부 이름은 예약되어 있고, 핸들은 정해진 횟수만 바꿀 수 있으며, 사람들을 오도하는 핸들을 쓰는 호스트는 이용을 정지할 수 있습니다.",
        "승인하기 전에 각 제안의 시간, 길이, 장소, 만날 사람을 확인하세요.",
        "확인한 설정을 정확하게 유지하세요. Thyme은 그 설정과 캘린더를 바탕으로 시간을 제안합니다.",
        "Google 연결 해제, iMessage 연결 해제, 에이전트 권한 철회는 언제든 할 수 있고, 계정 삭제는 개인정보 안내에 적힌 대로 요청할 수 있습니다.",
      ],
      paragraphs: ["Google로 로그인하면 호스트가 됩니다. 연결한 iMessage 주소와 개인 에이전트를 통한 일을 포함해, 계정에서 일어나는 일은 호스트가 책임집니다."],
      title: "호스트",
    },
    {
      id: "requesters",
      items: [
        "본인의 이름과 확인할 수 있는 이메일 주소를 알려 주세요. 예약 링크와 미팅 상태를 그 주소로 보냅니다.",
        "예약 링크는 본인만 가지고 계세요. 링크가 있으면 누구나 그 요청을 진행할 수 있습니다.",
        "요청은 예약이 아닙니다. 호스트는 요청을 거절하거나 다른 시간을 제안할 수 있으며, 호스트가 승인해야만 미팅이 예약됩니다.",
      ],
      paragraphs: ["호스트에게 미팅을 요청하는 데 계정은 필요 없습니다."],
      title: "호스트와 미팅을 잡는 분",
    },
    {
      id: "agents",
      paragraphs: [
        "findmeatime.com/SKILL.md의 공개 안내와 거기 적힌 연결 방법으로 개인 AI 에이전트를 쓸 수 있습니다. 연결한 에이전트는 동의 화면에서 허용한 권한 안에서만 움직이며, 에이전트에게 시킨 일은 본인이 책임집니다. 에이전트는 호스트를 대신해 미팅을 승인하거나 거절할 수 없습니다.",
        "Thyme은 AI 모델이라 요청을 잘못 이해하거나 실수할 수 있습니다. 화면의 제안, 확인 이메일, 캘린더의 일정이 기록이니, 대화만 믿지 말고 이것들을 확인하세요.",
      ],
      title: "AI 에이전트와 어시스턴트",
    },
    {
      id: "use",
      items: [
        "스팸이나 원치 않는 대량 요청을 보내거나, 누군가를 괴롭히거나 위협하거나 속이는 일.",
        "사람이나 단체를 사칭하거나, 권한 없이 다른 사람의 개인정보를 제출하는 일.",
        "본인 것이 아닌 요청, 캘린더, 대화, 계정에 접근하거나 권한, 한도, 보안 조치를 우회하는 일.",
        "서비스의 취약점을 탐색하거나 과부하를 주거나 방해하는 일, 또는 공개된 에이전트 안내와 연결 방법이 아닌 자동화된 방식으로 접근하는 일.",
        "법이나 다른 사람의 권리를 침해하는 일.",
      ],
      paragraphs: ["다음 용도로 서비스를 쓰면 안 됩니다."],
      title: "허용되지 않는 이용",
    },
    {
      id: "content",
      links: [{ href: "/privacy?lang=ko", label: "개인정보와 데이터" }],
      paragraphs: [
        "보낸 메시지, 요청, 설정에 대한 권리는 본인에게 있습니다. 서비스를 이용하면, 요청한 미팅의 일정을 잡는 데 필요한 만큼 개인정보 안내에 적힌 대로 저희가 그 내용을 저장하고 처리하고 보여 주는 것을 허락하게 됩니다. 예를 들어 요청 내용은 해당 호스트에게, 제안된 시간은 요청한 분에게 보여 줍니다.",
      ],
      title: "보낸 내용",
    },
    {
      id: "ending",
      paragraphs: [
        `이 약관을 어기거나 다른 사람이나 서비스를 위험하게 하는 경우 이용을 제한하거나 정지하거나 끝낼 수 있으며, 호스트 계정을 정지하거나 요청을 삭제할 수도 있습니다. 서비스는 언제든 그만 쓸 수 있고, 데이터 삭제는 ${SUPPORT_ADDRESS}로 요청해 주세요.`,
      ],
      title: "이용 제한과 종료",
    },
    {
      id: "liability",
      paragraphs: [
        "서비스는 법이 허용하는 범위에서 어떤 보증도 없이 있는 그대로, 제공할 수 있는 만큼 제공됩니다. 법이 허용하지 않는 경우를 빼고, 놓치거나 시간이 잘못 잡히거나 예약되지 않은 미팅, 서비스 밖에서 바뀐 캘린더 일정, 서비스 이용으로 생긴 간접적이거나 결과적인 손해에 대해 책임지지 않습니다.",
      ],
      title: "보증과 책임",
    },
    {
      id: "changes",
      paragraphs: ["이 약관을 바꿀 수 있으며, 바꾸면 이 페이지 위쪽의 날짜를 고칩니다. 바뀐 뒤에도 서비스를 계속 쓰면 바뀐 약관이 적용됩니다."],
      title: "약관 변경",
    },
    {
      id: "contact",
      paragraphs: [`이 약관에 관한 질문은 ${SUPPORT_ADDRESS}로 보내 주세요.`],
      title: "문의",
    },
  ],
  title: "이용약관",
  updated: "최종 수정 2026-11-02",
};

export default function Page({ searchParams }: { readonly searchParams: LegalSearchParams }) {
  return <LegalPage en={EN} ko={KO} searchParams={searchParams} />;
}
