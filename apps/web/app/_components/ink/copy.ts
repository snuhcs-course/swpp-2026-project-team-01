// English copy for the landing, messaging-channel starts and the /app link step.
// WhatsApp (host-whatsapp-channel D6, D7, D12) reuses the same screens: `wa` holds the words that differ, and
// channelCopy lays them over the iMessage words for a WhatsApp code or binding. Telegram (host-telegram-channel
// D6, D7, D13) does the same with `tg`: the host opens the bot and taps Start instead of sending a written note.
// A WhatsApp start asks for the number as iMessage does (guest-whatsapp-link D3), under `wa.number`'s heading.

import type { MessagingChannel } from "@lib/contracts/messaging-channel";

export type Locale = "en" | "ko";
export const LOCALE_COOKIE = "lang";
export const DEFAULT_LOCALE: Locale = "en";

// Old language cookies stay harmless: service screens now always use English.
export function localeOf(_value: string | undefined | null): Locale {
  return DEFAULT_LOCALE;
}

export type ExampleRow = string | { readonly name: string; readonly rest: string };
export type ExampleThread = {
  readonly tag?: string;
  readonly stamp: string;
  readonly alt: boolean;
  readonly lines: readonly { readonly who: "thyme" | "me"; readonly rows: readonly ExampleRow[]; readonly more?: boolean }[];
};

const en = {
  copy: { idle: "Copy", done: "Copied", fallback: "Select the text" },
  landing: {
    signIn: "Sign in",
    headline: ["The assistant that", "negotiates your meetings."],
    lede: "Share your link. Thyme settles the time and books it once you say OK.",
    google: "Continue with Google",
    noImessage: "No iMessage?",
    agentOr: "Or start from the AI agent you already use",
    agentPrompt: "Help me schedule with Find Me a Time. Read https://findmeatime.com/SKILL.md first. If you can't open it, run `curl -fsSL --max-time 20 https://findmeatime.com/SKILL.md`. Follow the instructions in the document.",
    agentLabel: "Prompt for your agent",
    agentNote: "Paste it into your agent. It walks you through the same setup.",
    agentRegion: "For AI agents",
    agentDoc: "Instructions for agents:",
    stepsTitle: "Three steps, then it runs in your messages.",
    steps: [
      ["Start with Google", "Sign in and connect your calendar in one step."],
      ["Link your phone", "Thyme texts you from then on."],
      ["Share your link", "Anyone can ask for a time. They need no account."],
    ],
    // What the service does, each beside a made-up example of it (product requirements: core rules 1 to 4,
    // FR-09, FR-10, FR-12 and FR-14).
    featuresTitle: "Thyme handles the back-and-forth.",
    features: [
      ["It negotiates for you.", "Thyme talks it through with the other person. It asks for what's missing, offers other times when theirs don't work, and asks you privately when nothing fits."],
      ["It knows where you'll be.", "Thyme reads where each meeting is, how you get around and the slack you want, and checks the trip there and the trip after. It never offers a time you can't make."],
      ["Your calendar stays yours.", "People see only the times Thyme offers. Your events, your rules and what you tell Thyme stay private."],
      ["No account for your guests.", "They answer on your booking page, by email or through their own AI agent, and see every time in their own timezone."],
      ["You approve every booking.", "Thyme shows you the exact proposal. Your OK puts it on your Google Calendar, and any change asks you again."],
    ],
    frag: {
      yourCalendar: "Your calendar",
      theySee: "What they see",
      negotiation: [
        { who: "guest", text: "Could we meet next Friday afternoon?" },
        { who: "thyme", text: "Friday afternoon is taken. Would Thursday at 4:00 PM or 4:30 PM work?" },
        { who: "guest", text: "Thursday at 4:00 PM, please." },
        { who: "thyme", text: "Done. I'll confirm as soon as it's approved." },
      ],
      coffee: "Coffee, Yeoksam",
      travel: (minutes: number) => `${minutes} min by transit`,
      buffer: (minutes: number) => `+${minutes} min slack`,
      place: "Seongsu",
      fits: "Fits",
      tooTight: "No time to get there",
      bookingPage: "Booking page",
      email: "Email",
      agent: "Their AI agent",
      noAccount: "No account",
      seoul: "Seoul",
      london: "London",
      proposal: "Proposal",
      minutes: (minutes: number) => `${minutes} min`,
      online: "Online",
      approve: "Approve",
      decline: "Decline",
    },
    tagline: "Thoughtful scheduling. One meeting at a time.",
    rights: "All rights reserved.",
    privacy: "Privacy and your data",
    terms: "Terms of service",
    legal: "Privacy and terms",
  },
  examples: {
    label: "Example conversations with Thyme",
    channel: "Text message",
    slide: (i: number, n: number) => `${i} of ${n}`,
    choose: "Choose an example",
    dot: (i: number, n: number) => `Example ${i} of ${n}`,
    // What each thread shows, in thread order, over the conversation on the landing.
    captions: ["Learns your week from your calendar.", "Suggests the rules. You decide.", "Text it like you'd text an assistant.", "Nothing is booked until you say OK."],
    threads: [
      {
        tag: "During setup", stamp: "Today 9:02 AM", alt: true,
        lines: [
          { who: "thyme", rows: ["I read the last 8 weeks of your calendar.", "• Meetings land Tue to Thu, 1 to 5 PM", "• Mornings stay clear", "• Fridays end by 3:00 PM"] },
          { who: "thyme", rows: ["I'll offer people those hours. OK?"] },
          { who: "me", rows: ["Perfect."] },
        ],
      },
      {
        tag: "During setup", stamp: "Today 9:04 AM", alt: true,
        lines: [
          { who: "thyme", rows: ["Your Wednesdays run back to back. 5 of the last 6 had no break after 2 PM."] },
          { who: "thyme", rows: ["Keep 15 minutes free between meetings?"] },
          { who: "me", rows: ["Yes please."] },
          { who: "thyme", rows: ["Done. Wednesdays get a breather."] },
        ],
      },
      {
        tag: "Anytime", stamp: "Yesterday 6:40 PM", alt: true,
        lines: [
          { who: "me", rows: ["By the way, who is Daniel Lee?"] },
          { who: "thyme", rows: ["Daniel is a partner at Lumen Ventures. You met for coffee on Sep 3 and had a call on Oct 1."] },
          { who: "me", rows: ["Find us a time next week."] },
          { who: "thyme", rows: ["Asking him now."] },
        ],
      },
      {
        stamp: "Today 8:30 AM", alt: false,
        lines: [
          { who: "thyme", rows: ["Two requests want Thu 3:00 PM.", { name: "Jisoo Kim", rest: ", investor → Thu 3:00 PM" }, { name: "Minho Park", rest: ", coffee → Fri 10:00 AM" }, "Investors come first. OK?"] },
          { who: "me", rows: ["Who's Minho again?"], more: true },
          { who: "thyme", rows: ["A PM at a robotics startup. You met at demo day in May. He wants hiring advice."], more: true },
          { who: "me", rows: ["OK, go ahead."] },
          { who: "thyme", rows: ["Jisoo is booked. I'll text you when Minho picks a time."] },
        ],
      },
    ] as readonly ExampleThread[],
  },
  // Sending Thyme the link message: the iMessage start on the landing and the /app link step.
  send: {
    start: "Onboard with iMessage",
    startOpensPhone: "Your Messages app opens with a note to Thyme already written. Tap send, then come back here.",
    startOpensDesktop: "Opens Messages with a note to Thyme already written: on a Mac, right here; on another computer, through a QR code for your iPhone.",
    fine: "By sending, you agree to get texts from Thyme about your meetings. Message and data rates may apply. Reply STOP to stop anytime.",
    to: "To",
    open: "Open Messages",
    opensNote: "Your Messages app opens with this note written. Tap send, then come back here.",
    qrTag: "IPHONE",
    qrTitle: "Scan with your iPhone",
    qrBody: "Messages opens with the note written. Tap send.",
    qrAlt: "QR code that opens Messages on your iPhone with the note to Thyme written",
    macTag: "MAC",
    macTitle: "Open Messages on this Mac",
    macBody: "Sends from the iMessage signed in on this Mac.",
    copyTag: "ANYWHERE",
    copyTitle: "Copy and send it yourself",
    copyBody: "Send this exact text to Thyme's number.",
    waitingFor: (time: string) => `Waiting · code works for ${time}`,
    expiredAt: (time: string) => `Expired at ${time}`,
    expiredMark: "Expired",
    close: "Close",
    popupTitle: "Send Thyme one message",
    popupLede: "It's already written. Send it from the iMessage you use, and this page moves on by itself.",
    expiredTitle: "This code expired.",
    expiredLede: "Codes work for 15 minutes, so nobody else can use one later. Make a new one and send it the same way.",
    newCode: "Make a new code",
    left: (time: string) => `${time} left`,
    waiting: "Waiting for your message…",
    waitingLede: "Tap send in Messages. This page moves on as soon as it arrives.",
    waitingStartLede: "Tap send in Messages, then come back here. Next, you sign in with Google once.",
    reopen: "Messages didn't open, or the note is gone? Open it again",
    received: "Got your message.",
    receivedLede: "One step left: sign in with Google, then confirm it was you.",
    from: "From",
    finishBy: (time: string) => `Finish within ${time}`,
    unavailable: "Starting from iMessage isn't available yet.",
    error: "Couldn't reach Thyme. Try again in a moment.",
    limited: "Too many tries for now. Wait a little and try again.",
    lost: "The answer was lost. Try again; it won't be repeated.",
  },
  // The /app link step after Google sign-in.
  // The number asked before an iMessage link code (imessage-number-registration D3), from the landing
  // redesign's phone screen.
  number: {
    heading: "Which number do you use for iMessage?",
    lede: "Thyme only reads messages from numbers it knows. Enter yours, then send Thyme one message from it.",
    label: "Mobile number",
    country: "Country code",
    help: "Hyphens are added for you.",
    errorKr: "Enter a mobile number like 10-1234-5678.",
    errorOther: "Check the number. It looks incomplete.",
    errorServer: "Couldn't register this number. Try again in a moment.",
    submit: "Next",
    fine: "Thyme uses this number only to recognize your messages. iMessage only for now.",
  },
  link: {
    heading: "Connect Thyme to your iMessage",
    lede: "Send Thyme one message from the iMessage you use. It's already written, and sending it links this account.",
    ledePhone: "Send Thyme one message. It's already written for you, and sending it links this account.",
    altDesktop: "No iPhone, or rather not now?",
    altPhone: "On Android, or rather not now?",
    skip: "Set up here in web chat",
    confirmTitle: "Is this you?",
    confirmLede: "We got your message. Link it only if it came from your iPhone.",
    sentFrom: "Sent from",
    confirmWithin: (time: string) => `Confirm within ${time}`,
    confirm: "Confirm and link",
    notMe: "This isn't me",
    linking: "Linking…",
    connected: "Your iMessage is connected.",
    connectedLede: "You can onboard with Thyme in iMessage. Thyme just sent you a hello there.",
    // Back from Google consent started at Thyme's Calendar link (host-imessage-channel D19).
    calendarConnected: "Google Calendar is connected.",
    calendarConnectedLede: "Setup continues in iMessage. Thyme just sent you the next step there.",
    linkedTo: "Linked to",
    goHome: "Go to Home",
    chatWeb: "Or chat with Thyme on the web",
    expired: "Time's up.",
    expiredLede: "The note ran out before your message came in. A new one takes a tap.",
    again: "Write a new message",
    askTitle: "Connect a messaging app",
    askLede: "Choose where Thyme should reach you to finish setup and coordinate meetings.",
    unavailableTitle: "Messaging is unavailable right now.",
    unavailableLede: "We couldn't start a secure link. Try again in a moment; your Google sign-in is saved.",
    retry: "Try again",
    chooseAnother: "Choose a messaging app",
    openConnected: (name: string) => "Open " + name,
    switchTo: (name: string) => `Use ${name} instead`,
    replacesImessage: "This replaces your iMessage link.",
    replacesWhatsapp: "This replaces your WhatsApp link.",
    replacesTelegram: "This replaces your Telegram link.",
    optIn: "Thyme will message you on WhatsApp about your requests. If you have not written for a day, it sends a short notice instead.",
    privacyTelegram: "Telegram keeps bot chats on its servers. Find Me a Time sends your request summaries here.",
  },
  // The words that differ for WhatsApp, laid over the ones above by channelCopy.
  wa: {
    landing: { noImessage: "No WhatsApp?" },
    // The number asked before a WhatsApp link code too (guest-whatsapp-link D3).
    number: {
      heading: "Which number do you use for WhatsApp?",
      fine: "Thyme uses this number only to recognize your messages.",
    },
    send: {
      start: "Onboard with WhatsApp",
      startOpensPhone: "WhatsApp opens with a note to Thyme already written. Tap send, then come back here.",
      startOpensDesktop: "Opens WhatsApp with a note to Thyme already written: on this computer, or through a QR code for your phone.",
      fine: "By sending, you agree to get WhatsApp messages from Thyme about your meetings. Reply STOP to stop anytime.",
      open: "Open WhatsApp",
      opensNote: "WhatsApp opens with this note written. Tap send, then come back here.",
      qrTag: "PHONE",
      qrTitle: "Scan with your phone",
      qrBody: "WhatsApp opens with the note written. Tap send.",
      qrAlt: "QR code that opens WhatsApp on your phone with the note to Thyme written",
      macTag: "THIS COMPUTER",
      macTitle: "Open WhatsApp here",
      macBody: "Opens WhatsApp Web or the WhatsApp app on this computer.",
      popupLede: "It's already written. Send it from the WhatsApp you use, and this page moves on by itself.",
      waitingLede: "Tap send in WhatsApp. This page moves on as soon as it arrives.",
      waitingStartLede: "Tap send in WhatsApp, then come back here. Next, you sign in with Google once.",
      reopen: "WhatsApp didn't open, or the note is gone? Open it again",
      unavailable: "Starting from WhatsApp isn't available yet.",
    },
    link: {
      heading: "Connect Thyme to your WhatsApp",
      lede: "Send Thyme one message from the WhatsApp you use. It's already written, and sending it links this account.",
      altDesktop: "Rather not now?",
      altPhone: "Rather not now?",
      confirmLede: "We got your message. Link it only if it came from your WhatsApp.",
      connected: "Your WhatsApp is connected.",
      connectedLede: "You can onboard with Thyme in WhatsApp. Thyme just sent you a hello there.",
      calendarConnectedLede: "Setup continues in WhatsApp. Thyme just sent you the next step there.",
    },
  },
  // The words that differ for Telegram, laid over the iMessage ones by channelCopy.
  tg: {
    landing: { noImessage: "No Telegram?" },
    send: {
      start: "Onboard with Telegram",
      startOpensPhone: "Telegram opens at Thyme's bot. Tap Start, then come back here.",
      startOpensDesktop: "Opens Thyme's bot in Telegram: on this computer, or through a QR code for your phone.",
      fine: "By tapping Start, you agree to get Telegram messages from Thyme about your meetings. Send /stop to stop anytime.",
      open: "Open Telegram",
      opensNote: "Telegram opens at Thyme's bot. Tap Start, then come back here.",
      qrTag: "PHONE",
      qrTitle: "Scan with your phone",
      qrBody: "Telegram opens at Thyme's bot. Tap Start.",
      qrAlt: "QR code that opens Thyme's bot in Telegram on your phone",
      macTag: "THIS COMPUTER",
      macTitle: "Open Telegram here",
      macBody: "Opens Telegram Desktop or Telegram Web on this computer.",
      copyBody: "Open this link in Telegram, or send the code to the bot.",
      popupTitle: "Start Thyme's bot in Telegram",
      popupLede: "Open Thyme's bot in the Telegram you use and tap Start. This page moves on by itself.",
      waitingLede: "Tap Start in Telegram. This page moves on as soon as it arrives.",
      waitingStartLede: "Tap Start in Telegram, then come back here. Next, you sign in with Google once.",
      reopen: "Telegram didn't open? Open it again",
      unavailable: "Starting from Telegram isn't available yet.",
    },
    link: {
      heading: "Connect Thyme to your Telegram",
      lede: "Open Thyme's bot in the Telegram you use and tap Start. That links this account.",
      ledePhone: "Open Thyme's bot in Telegram and tap Start. That links this account.",
      altDesktop: "Rather not now?",
      altPhone: "Rather not now?",
      confirmLede: "We got your Start. Link it only if it came from your Telegram.",
      connected: "Your Telegram is connected.",
      connectedLede: "You can onboard with Thyme in Telegram. Thyme just sent you a hello there.",
      calendarConnectedLede: "Setup continues in Telegram. Thyme just sent you the next step there.",
    },
  },
};

export type Copy = typeof en;

export const COPY: Record<Locale, Copy> = { en, ko: en };

// The words for a channel's screens: WhatsApp's or Telegram's laid over the iMessage ones.
export function channelCopy(t: Copy, channel: MessagingChannel): Copy {
  if (channel === "imessage") return t;
  const over = channel === "whatsapp" ? t.wa : t.tg;
  const number = channel === "whatsapp" ? { ...t.number, ...t.wa.number } : t.number;
  return { ...t, landing: { ...t.landing, ...over.landing }, link: { ...t.link, ...over.link }, number, send: { ...t.send, ...over.send } };
}

// "This replaces your … link." for the channel a confirmation would replace (D5).
export function replacesText(t: Copy, channel: MessagingChannel) {
  if (channel === "whatsapp") return t.link.replacesWhatsapp;
  if (channel === "telegram") return t.link.replacesTelegram;
  return t.link.replacesImessage;
}
