import { deploymentEnvironment } from "./deployment";
import type { NoteClassifierModel } from "./note-classifier";
import { createOpenAiNoteClassifier } from "./note-classifier-openai";

// Which note classifier a deployment uses (calendar-note-review design 2):
// NOTE_CLASSIFIER=openai calls gpt-5.6-terra with OPENAI_API_KEY; outside
// production, NOTE_CLASSIFIER=stand_in answers from fixed title rules, so local
// runs and browser tests show recommendations without spending on a model, and
// OPENAI_BASE_URL may point the OpenAI call at a local stand-in. Unset, no
// classifier runs and every candidate is listed without a recommendation.

type Environment = Readonly<Record<string, string | undefined>>;

const NOTE_WORDS = /생일|기념일|마감|분리수거|휴일|공휴일|기일|birthday|anniversary|deadline|due|holiday|reminder|recycling/i;
const EVENT_WORDS = /헬스|운동|수업|강의|병원|치과|출근|통근|회의|gym|workout|class|lecture|dentist|doctor|commute|focus/i;

const REASONS = {
  en: { event: "Sounds like time you spend.", note: "Reads like a reminder, not time you spend." },
  ko: { event: "직접 시간을 쓰는 일정처럼 보여요.", note: "시간을 쓰는 일정이 아니라 기억해 둘 메모처럼 보여요." },
} as const;

// Fixed answers by title words, for local runs and tests only. It reads the
// title as data like the real classifier: an instruction in it is just text.
export const standInNoteClassifier: NoteClassifierModel = async (items) =>
  items.map((item) => {
    const verdict = NOTE_WORDS.test(item.title) ? "note" : EVENT_WORDS.test(item.title) ? "event" : "unsure";
    return {
      id: item.id,
      reason_en: verdict === "unsure" ? "" : REASONS.en[verdict],
      reason_ko: verdict === "unsure" ? "" : REASONS.ko[verdict],
      verdict,
    };
  });

export function noteClassifierFromEnvironment(env: Environment = process.env): NoteClassifierModel | undefined {
  const production = deploymentEnvironment(env) === "production";
  const mode = env.NOTE_CLASSIFIER?.trim();

  if (mode === "stand_in" && !production) return standInNoteClassifier;
  if (mode === "openai" && env.OPENAI_API_KEY) {
    const base = !production ? env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "") : undefined;
    return createOpenAiNoteClassifier({ apiKey: env.OPENAI_API_KEY, ...(base ? { endpoint: `${base}/responses` } : {}) });
  }
  return undefined;
}
