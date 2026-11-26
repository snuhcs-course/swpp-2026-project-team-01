import { defineEval, type EveEvalContext, type EveEvalTurn } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import type { ConfirmedSettings } from "../../lib/contracts/setup";
import { questionSchema } from "../../lib/server/host-assistant-context";
import { enqueueHostNotice } from "../../lib/server/imessage-notices";
import { requestRef } from "../../lib/server/request-ref";
import { seedHost } from "../story/fixtures";
import { grade } from "../story/grader";
import { storyRuntime } from "../story/runtime";
import { agreedForHost, buildState } from "../story/states";
import { accountSession, prepareSavedHost, setupHost } from "./support";

// Live dynamic resolution is the serializability guard: eve@0.80.1 exposes no
// public transform-and-resolve checker for unit tests. Every case resolves the
// real account tools and scope-bound memory tools, with no tool stubs.
function check(t: EveEvalContext, value: boolean, label: string) {
  t.check(value, satisfies((ok: boolean) => ok, label)).label(label);
}
function called(t: EveEvalContext, turn: EveEvalTurn, name: string | readonly string[]) {
  const names = typeof name === "string" ? [name] : name;
  check(t, turn.toolCalls.some(call => names.includes(call.name)), `calls ${names.join(" or ")}`);
}
function forbid(t: EveEvalContext, turn: EveEvalTurn, names: readonly string[]) {
  check(t, turn.toolCalls.every(call => !names.includes(call.name)), `does not call ${names.join(", ")}`);
}
async function rubric(t: EveEvalContext, transcript: string, reply: string | undefined, criterion: string) {
  const verdict = await grade(criterion, transcript, reply ?? "");
  t.log(`${verdict.pass ? "pass" : "fail"}: ${criterion}: ${verdict.reason}`);
  check(t, verdict.pass, criterion);
}
const DECISIONS = ["decide_requests", "propose_shared_changes", "share_changes", "dismiss_changes", "change_booking", "finish_sample_tutorial", "waive_weekly_limit", "allow_host_trip"];
async function requestState(requestId: string) {
  const [row] = await storyRuntime().db<{ state: string; approvals: number; bookings: number }[]>`
    select r.state, (select count(*)::int from app.approvals a where a.request_id = r.id) as approvals,
      (select count(*)::int from app.bookings b where b.request_id = r.id) as bookings
    from app.requests r where r.id = ${requestId}`;
  return row!;
}
async function settings(hostId: string) {
  const [row] = await storyRuntime().db<{ settings: ConfirmedSettings; tutorial_offered: boolean }[]>`
    select settings, tutorial_offered from app.host_settings where host_account_id = ${hostId}`;
  return row;
}
async function twoRequests() {
  const host = await seedHost();
  const a = await agreedForHost({ host, requesterName: "Eunwoo", language: "en" });
  const b = await agreedForHost({ host, requesterName: "Dohyeon", language: "en" });
  return { host, a: a.request, b: b.request };
}

type Case = { id: string; source: string; turns: number; test(t: EveEvalContext): Promise<void> };
const cases: readonly Case[] = [
  { id: "AS-01", source: "A1: two decisions in one turn", turns: 2, async test(t) {
    const { host, a, b } = await twoRequests();
    const session = await accountSession(t, host.hostAccountId);
    const turn = await session.send("Approve Eunwoo's and decline Dohyeon's.");
    called(t, turn, "decide_requests");
    check(t, turn.toolCalls.filter(call => call.name === "decide_requests").length === 1, "one batch decision call");
    check(t, ["booking", "booked"].includes((await requestState(a.requestId)).state), "Eunwoo approved");
    check(t, (await requestState(b.requestId)).state === "declined", "Dohyeon declined");
    await rubric(t, "Host: Approve Eunwoo's and decline Dohyeon's.", turn.message,
      "Reports the outcome for both Eunwoo and Dohyeon separately and does not call an approval a confirmed booking without a booked tool result.");
    called(t, await session.send("What does my next week look like?"), "read_schedule");
  } },
  { id: "AS-02", source: "A2: own schedule at any point", turns: 2, async test(t) {
    const { request } = await buildState("RV-A1", "ko");
    const session = await accountSession(t, request.hostAccountId);
    for (const message of ["Show me my schedule tomorrow.", "나 다음 주에 약속 없는지 확인해 줄래?"]) {
      const turn = await session.send(message);
      called(t, turn, "read_schedule");
      await rubric(t, `Host: ${message}`, turn.message, "Answers the account owner's schedule question from read_schedule, without claiming this conversation cannot access the owner's calendar.");
    }
  } },
  { id: "AS-03", source: "A7: pending ledger target beside another waiting request and notices", turns: 2, async test(t) {
    const { host, a, b } = await twoRequests();
    const session = await accountSession(t, host.hostAccountId);
    await storyRuntime().db.begin(tx => enqueueHostNotice(tx, b.requestId, { kind: "awaiting_approval", version: 1 }));
    const prompt = "Eunwoo 요청을 승인할지 나한테 한 번 확인해줘. 아직 승인하지 마.";
    const question = await session.send(prompt);
    called(t, question, "account__question");
    forbid(t, question, DECISIONS);
    check(t, (await requestState(a.requestId)).state === "awaiting_host_approval" && (await requestState(b.requestId)).state === "awaiting_host_approval", "both requests still wait before yes");
    const ledger = await storyRuntime().db<{ content: unknown }[]>`select content from app.host_assistant_context
      where host_account_id = ${host.hostAccountId} and kind = 'question' and confirmed and forgotten_at is null`;
    const pending = questionSchema.safeParse(ledger[0]?.content);
    check(t, ledger.length === 1 && pending.success && pending.data.ref === requestRef(a.requestId)
      && pending.data.direction === "received" && pending.data.decision === "approve", "confirmed ledger names only Eunwoo's approval");
    await rubric(t, prompt, question.message, "Asks whether to approve Eunwoo's request and does not claim to have approved it yet.");
    // send() flushed the waiting-request notices after the question turn.
    check(t, session.delivered.some(item => item.kind === "text" && item.text.includes("Dohyeon")), "other request notice delivered between question and yes");
    const yes = await session.send("응");
    called(t, yes, "decide_requests");
    check(t, ["booking", "booked"].includes((await requestState(a.requestId)).state), "yes approves ledger target");
    check(t, (await requestState(b.requestId)).state === "awaiting_host_approval" && (await requestState(b.requestId)).approvals === 0, "notice did not retarget yes to Dohyeon");
  } },
  { id: "AS-H01-5", source: "H01-5: Calendar claim without a grant", turns: 1, async test(t) {
    const host = await setupHost(false);
    const session = await accountSession(t, host.hostAccountId);
    const turn = await session.send("캘린더 연결했어");
    called(t, turn, "read_setup_state");
    forbid(t, turn, ["draft_settings", "confirm_settings", "choose_request_tutorial", "preview_next_week"]);
    check(t, /\/auth\/sign-in\?[^\s]*consent=calendar/.test(turn.message ?? ""), "resends Calendar consent link");
    check(t, !(await settings(host.hostAccountId)), "no settings saved without Calendar");
    await rubric(t, "Host: 캘린더 연결했어\nDB: Calendar is not connected.", turn.message,
      "한국어로 아직 캘린더 연결이 확인되지 않았다고 알리고 Google 연결 링크를 다시 준다. Google Calendar를 읽어 바쁜 시간을 찾고 미팅 시간을 제안하며 승인한 미팅만 추가하고 게스트는 일정 내용을 볼 수 없다고 한국어로 알린다. 미팅 가능 시간을 묻지 않는다.");
  } },
  { id: "AS-H01-7-10", source: "H01-7..10: hours, place, revise preview, confirm", turns: 5, async test(t) {
    const host = await setupHost(true);
    const session = await accountSession(t, host.hostAccountId);
    const transcript: string[] = [];
    const opening = await session.send("미팅 가능한 시간을 추천해줘");
    transcript.push(`Host: 미팅 가능한 시간을 추천해줘\nAssistant: ${opening.message}`);
    const hours = await session.send("응, 그렇게 해줘");
    called(t, hours, "draft_settings");
    forbid(t, hours, ["confirm_settings"]);
    await rubric(t, transcript.join("\n"), hours.message, "미팅 가능 시간에 동의한 것으로 받아들이고 평소 만나는 장소를 묻는다.");
    transcript.push(`Host: 응, 그렇게 해줘\nAssistant: ${hours.message}`);
    const placeText = "역삼역 근처, 온라인도 괜찮고 지하철로 갈 거 같아";
    const place = await session.send(placeText);
    called(t, place, "draft_settings"); called(t, place, "preview_next_week");
    check(t, session.delivered.some(item => item.kind === "image"), "first slot image delivered");
    check(t, !(await settings(host.hostAccountId)), "place answer does not save settings");
    transcript.push(`Host: ${placeText}\nAssistant: ${place.message}`);
    const imageCount = session.delivered.filter(item => item.kind === "image").length;
    const changed = await session.send("목요일은 빼줘");
    called(t, changed, "draft_settings"); called(t, changed, "preview_next_week");
    forbid(t, changed, ["confirm_settings"]);
    const images = session.delivered.filter(item => item.kind === "image");
    check(t, images.length > imageCount, "changed settings deliver a new image");
    const image = images.at(-1);
    check(t, image?.preview.days.some(day => day.weekday === "thursday" && day.open.length === 0) === true, "new image excludes Thursday");
    check(t, !(await settings(host.hostAccountId)), "no booking settings/link before yes");
    check(t, !/https?:\/\/\S+/.test(`${place.message ?? ""}\n${changed.message ?? ""}`), "no booking link before yes");
    const saved = await session.send("ㅇㅋ 이대로 열어줘");
    called(t, saved, "confirm_settings"); forbid(t, saved, ["choose_request_tutorial"]);
    const row = await settings(host.hostAccountId);
    check(t, row !== undefined && row.settings.meetingMode === "either" && row.settings.travelMode === "transit"
      && row.settings.location !== null && row.settings.location.kind === "places" && row.settings.location.areas.some(area => area.includes("역삼"))
      && row.settings.weeklyWindows.every(window => window.weekday !== "thursday") && row.tutorial_offered, "saved host answers, Thursday exclusion and tutorial offer");
    check(t, row !== undefined && (saved.message ?? "").includes(`${process.env.APP_ORIGIN}/${row.settings.handle}`), "actual booking link returned after yes");
    await rubric(t, [...transcript, "Host: 목요일은 빼줘", `Assistant: ${changed.message}`, "Host: ㅇㅋ 이대로 열어줘"].join("\n"), saved.message,
      "설정이 끝났다고 알리고 실제 도구가 반환한 예약 링크를 공유하며 샘플 요청 연습을 제안한다. 연습은 아직 시작하거나 건너뛰지 않는다.");
  } },
  { id: "AS-H01-11", source: "H01-11: exact next-step reply, no tutorial choice", turns: 1, async test(t) {
    const host = await seedHost();
    await storyRuntime().db`update app.host_settings set tutorial_offered = true where host_account_id = ${host.hostAccountId}`;
    const session = await accountSession(t, host.hostAccountId);
    const turn = await session.send("이제 뭐하면 돼?");
    const exact = "이 링크를 미팅할 사람과 공유하면 돼요. 제가 사용자님의 시간에 맞춰서 예약을 잡고, 안내해드릴게요.";
    check(t, (turn.message ?? "").replace(/\s+/g, " ").trim() === exact, "exact H01-11 sentence and nothing appended");
    forbid(t, turn, ["choose_request_tutorial", ...DECISIONS]);
    const samples = await storyRuntime().db`select id from app.requests where host_account_id = ${host.hostAccountId} and is_sample`;
    check(t, samples.length === 0 && (await settings(host.hostAccountId))?.tutorial_offered === true, "tutorial neither started nor skipped");
  } },
  { id: "AS-H01-12-13", source: "H01-12..13: sample tutorial approval", turns: 2, async test(t) {
    const host = await seedHost();
    await storyRuntime().db`update app.host_settings set tutorial_offered = true where host_account_id = ${host.hostAccountId}`;
    const session = await accountSession(t, host.hostAccountId);
    const start = await session.send("응, 샘플 요청으로 연습해볼게");
    called(t, start, "choose_request_tutorial");
    const [sample] = await storyRuntime().db<{ id: string }[]>`select id from app.requests where host_account_id = ${host.hostAccountId} and is_sample and closed_at is null`;
    check(t, Boolean(sample), "one active sample request created");
    check(t, session.delivered.some(item => item.kind === "text" && /샘플/.test(item.text)), "sample request shown in the messenger");
    const approval = await session.send("샘플 요청 승인해줘");
    check(t, approval.toolCalls.some(call => ["decide_requests", "finish_sample_tutorial"].includes(call.name)), "sample approval uses guarded tool");
    const [state] = await storyRuntime().db<{ closed: boolean }[]>`select closed_at is not null as closed from app.requests where id = ${sample!.id}`;
    check(t, state?.closed === true && (await requestState(sample!.id)).bookings === 0, "tutorial finishes without booking");
    check(t, storyRuntime().google.createdEvents(host.calendarId).length === 0, "no Google Calendar event created");
    await rubric(t, "Host: 샘플 요청 승인해줘", approval.message, "샘플 연습을 승인해 끝냈으며 실제 캘린더 일정은 만들지 않았다고 말한다.");
  } },
  { id: "AS-H03-1-4", source: "H03-1..4: understand, explain, defer a waiting request", turns: 3, async test(t) {
    const { request } = await buildState("RV-A1b", "ko");
    const session = await accountSession(t, request.hostAccountId);
    const before = await requestState(request.requestId);
    const transcript: string[] = [];
    const turns: readonly (readonly [string, string])[] = [
      ["이 사람 누구야? 무슨 미팅이야?", "요청자 Minji Kim과 컴파일러 이야기 커피챗이라는 목적을 말한다. 호스트가 합의했거나 예약된 미팅이라고 부르지 않는다."],
      ["왜 이 시간이 가능한 거야?", "실제 도구가 반환한 미팅 가능 시간, 캘린더의 바쁜 시간과 이동 조건을 근거로 제안된 시각이 가능한 이유를 설명한다. 미팅을 승인하거나 확정했다고 말하지 않는다."],
      ["음, 좀 생각해볼게", "고민할 시간을 주고 아직 승인이 필요한 요청임을 유지한다. 승인, 거절, 변경 또는 예약 완료를 주장하지 않는다."],
    ];
    for (const [message, criterion] of turns) {
      const turn = await session.send(message);
      forbid(t, turn, DECISIONS);
      await rubric(t, [...transcript, `Host: ${message}`].join("\n"), turn.message, criterion);
      transcript.push(`Host: ${message}\nAssistant: ${turn.message}`);
      check(t, JSON.stringify(await requestState(request.requestId)) === JSON.stringify(before), "waiting request decision state unchanged");
      if (message === turns[0]![0]) called(t, turn, "read_request");
      if (message === turns[1]![0]) called(t, turn, "evaluate_candidates");
    }
  } },
  { id: "AS-H04-6", source: "H04-6: this week's booking is not next week's", turns: 1, async test(t) {
    const { request } = await buildState("RV-A4", "ko");
    const runtime = storyRuntime();
    // Move the fixture booking into the current Seoul week, including the fake
    // Google record, so read_schedule cannot accidentally see it next week.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const start = new Date(`${today}T10:00:00+09:00`);
    const end = new Date(start.getTime() + 30 * 60_000);
    await runtime.db`update app.bookings set start_at = ${start}, end_at = ${end}, reserved_start = ${start}, reserved_end = ${end} where request_id = ${request.requestId}`;
    await runtime.db`update app.proposals set start_at = ${start}, end_at = ${end} where request_id = ${request.requestId}`;
    for (const event of runtime.google.createdEvents(request.calendarId)) {
      event.start.dateTime = start.toISOString(); event.end.dateTime = end.toISOString();
    }
    const session = await accountSession(t, request.hostAccountId);
    const turn = await session.send("다음 주 확정된 미팅 뭐 있어?");
    called(t, turn, "read_schedule"); forbid(t, turn, DECISIONS);
    await rubric(t, "Host: 다음 주 확정된 미팅 뭐 있어?\nDB: 박도현의 투자 상담 미팅 하나가 이번 주에 예약되어 있고 다음 주 예약은 없다.", turn.message,
      "다음 주에 확정된 미팅은 없다고 분명히 말하고, 박도현의 투자 상담 미팅은 이번 주 일정이라고 이름과 함께 구분한다.");
    check(t, (await requestState(request.requestId)).state === "booked", "existing booking unchanged");
  } },
  // Appended fixture corrections; see documentation 13, Appended cases.
  { id: "AS-H01-11-SAVED", source: "H01-11: exact next-step reply, no tutorial choice", turns: 1, async test(t) {
    const host = await seedHost();
    await prepareSavedHost(host);
    await storyRuntime().db`update app.host_settings set tutorial_offered = true where host_account_id = ${host.hostAccountId}`;
    const session = await accountSession(t, host.hostAccountId);
    const turn = await session.send("이제 뭐하면 돼?");
    const exact = "이 링크를 미팅할 사람과 공유하면 돼요. 제가 사용자님의 시간에 맞춰서 예약을 잡고, 안내해드릴게요.";
    check(t, (turn.message ?? "").replace(/\s+/g, " ").trim() === exact, "exact H01-11 sentence and nothing appended");
    forbid(t, turn, ["choose_request_tutorial", ...DECISIONS]);
    const samples = await storyRuntime().db`select id from app.requests where host_account_id = ${host.hostAccountId} and is_sample`;
    check(t, samples.length === 0 && (await settings(host.hostAccountId))?.tutorial_offered === true, "tutorial neither started nor skipped");
  } },
  { id: "AS-H01-12-13-SAVED", source: "H01-12..13: sample tutorial approval", turns: 2, async test(t) {
    const host = await seedHost();
    await prepareSavedHost(host);
    await storyRuntime().db`update app.host_settings set tutorial_offered = true where host_account_id = ${host.hostAccountId}`;
    const session = await accountSession(t, host.hostAccountId);
    const start = await session.send("응, 샘플 요청으로 연습해볼게");
    called(t, start, "choose_request_tutorial");
    const [sample] = await storyRuntime().db<{ id: string }[]>`select id from app.requests where host_account_id = ${host.hostAccountId} and is_sample and closed_at is null`;
    check(t, Boolean(sample), "one active sample request created");
    check(t, session.delivered.some(item => item.kind === "text" && /샘플/.test(item.text)), "sample request shown in the messenger");
    const approval = await session.send("샘플 요청 승인해줘");
    check(t, approval.toolCalls.some(call => ["decide_requests", "finish_sample_tutorial"].includes(call.name)), "sample approval uses guarded tool");
    const [state] = await storyRuntime().db<{ closed: boolean }[]>`select closed_at is not null as closed from app.requests where id = ${sample!.id}`;
    check(t, state?.closed === true && (await requestState(sample!.id)).bookings === 0, "tutorial finishes without booking");
    check(t, storyRuntime().google.createdEvents(host.calendarId).length === 0, "no Google Calendar event created");
    await rubric(t, "Host: 샘플 요청 승인해줘", approval.message, "샘플 연습을 승인해 끝냈으며 실제 캘린더 일정은 만들지 않았다고 말한다.");
  } },
  { id: "AS-H01-7-10-ANALYZED", source: "H01-7..10: hours, place, revise preview, confirm", turns: 4, async test(t) {
    const host = await setupHost(true);
    const session = await accountSession(t, host.hostAccountId);
    const opening = await session.deliverHoursQuestion();
    const transcript: string[] = [`Service: ${opening}`];
    check(t, session.delivered.some(item => item.kind === "text" && item.text === opening), "step-6 hours suggestion delivered before the first host line");
    const hours = await session.send("응, 그렇게 해줘");
    called(t, hours, "draft_settings");
    forbid(t, hours, ["confirm_settings"]);
    await rubric(t, transcript.join("\n"), hours.message, "미팅 가능 시간에 동의한 것으로 받아들이고 평소 만나는 장소를 묻는다.");
    transcript.push(`Host: 응, 그렇게 해줘\nAssistant: ${hours.message}`);
    const placeText = "역삼역 근처, 온라인도 괜찮고 지하철로 갈 거 같아";
    const place = await session.send(placeText);
    called(t, place, "draft_settings"); called(t, place, "preview_next_week");
    check(t, place.toolCalls.filter(call => call.name === "draft_settings").length === 1, "one write for the stated place answer");
    check(t, session.delivered.some(item => item.kind === "image"), "first slot image delivered");
    check(t, !(await settings(host.hostAccountId)), "place answer does not save settings");
    transcript.push(`Host: ${placeText}\nAssistant: ${place.message}`);
    const imageCount = session.delivered.filter(item => item.kind === "image").length;
    const changed = await session.send("목요일은 빼줘");
    called(t, changed, "draft_settings"); called(t, changed, "preview_next_week");
    check(t, changed.toolCalls.filter(call => call.name === "draft_settings").length === 1, "one write for Thursday exclusion");
    forbid(t, changed, ["confirm_settings"]);
    const images = session.delivered.filter(item => item.kind === "image");
    check(t, images.length > imageCount, "changed settings deliver a new image");
    const image = images.at(-1);
    check(t, image?.preview.days.some(day => day.weekday === "thursday" && day.open.length === 0) === true, "new image excludes Thursday");
    check(t, !(await settings(host.hostAccountId)), "no booking settings/link before yes");
    check(t, !/https?:\/\/\S+/.test(`${place.message ?? ""}\n${changed.message ?? ""}`), "no booking link before yes");
    const saved = await session.send("ㅇㅋ 이대로 열어줘");
    called(t, saved, "confirm_settings"); forbid(t, saved, ["choose_request_tutorial"]);
    const row = await settings(host.hostAccountId);
    check(t, row !== undefined && row.settings.meetingMode === "either" && row.settings.travelMode === "transit"
      && row.settings.location !== null && row.settings.location.kind === "places" && row.settings.location.areas.some(area => area.includes("역삼"))
      && row.settings.weeklyWindows.every(window => window.weekday !== "thursday") && row.tutorial_offered, "saved host answers, Thursday exclusion and tutorial offer");
    check(t, row !== undefined && (saved.message ?? "").includes(`${process.env.APP_ORIGIN}/${row.settings.handle}`), "actual booking link returned after yes");
    await rubric(t, [...transcript, "Host: 목요일은 빼줘", `Assistant: ${changed.message}`, "Host: ㅇㅋ 이대로 열어줘", `confirm_settings result: ${JSON.stringify(saved.toolCalls.find(call => call.name === "confirm_settings")?.output)}`].join("\n"), saved.message,
      "설정이 끝났다고 알리고 실제 도구가 반환한 예약 링크를 공유하며 샘플 요청 연습을 제안한다. 연습은 아직 시작하거나 건너뛰지 않는다.");
  } },
  { id: "AS-H03-1-4-BASIS", source: "H03-1..4: understand, explain, defer a waiting request", turns: 3, async test(t) {
    const { request } = await buildState("RV-A1b", "ko");
    await prepareSavedHost(request);
    const session = await accountSession(t, request.hostAccountId);
    const before = await requestState(request.requestId);
    const transcript: string[] = [];
    const turns: readonly (readonly [string, string])[] = [
      ["이 사람 누구야? 무슨 미팅이야?", "요청자 Minji Kim과 컴파일러 이야기 커피챗이라는 목적을 말한다. 호스트가 합의했거나 예약된 미팅이라고 부르지 않는다."],
      ["왜 이 시간이 가능한 거야?", "실제 도구가 반환한 미팅 가능 시간, 캘린더의 바쁜 시간과 이동 조건을 근거로 제안된 시각이 가능한 이유를 설명한다. 미팅을 승인하거나 확정했다고 말하지 않는다."],
      ["음, 좀 생각해볼게", "고민할 시간을 주고 아직 승인이 필요한 요청임을 유지한다. 승인, 거절, 변경 또는 예약 완료를 주장하지 않는다."],
    ];
    for (const [message, criterion] of turns) {
      const turn = await session.send(message);
      forbid(t, turn, DECISIONS);
      check(t, turn.toolCalls.filter(call => call.name === "read_request").length <= 1, "at most one current request read per turn");
      check(t, turn.toolCalls.filter(call => call.name === "evaluate_candidates").length <= 1, "no repeated evaluation per turn");
      await rubric(t, [...transcript, `Host: ${message}`, `Tool evidence: ${JSON.stringify(turn.toolCalls.map(call => ({ name: call.name, output: call.output })))}`].join("\n"), turn.message, criterion);
      transcript.push(`Host: ${message}\nAssistant: ${turn.message}`);
      check(t, JSON.stringify(await requestState(request.requestId)) === JSON.stringify(before), "waiting request decision state unchanged");
      if (message === turns[0]![0]) called(t, turn, ["list_host_requests", "read_request"]);
      if (message === turns[1]![0]) called(t, turn, "read_request");
    }
  } },
  // Appended 2026-11-26: several asks of different kinds in one host message.
  { id: "AS-M01", source: "A1 + A2: a decision and a schedule question in one message", turns: 1, async test(t) {
    const { host, a, b } = await twoRequests();
    const session = await accountSession(t, host.hostAccountId);
    const message = "Eunwoo 거 승인하고 내일 내 일정도 알려줘";
    const turn = await session.send(message);
    called(t, turn, "decide_requests");
    called(t, turn, "read_schedule");
    check(t, ["booking", "booked"].includes((await requestState(a.requestId)).state), "Eunwoo approved");
    check(t, (await requestState(b.requestId)).state === "awaiting_host_approval" && (await requestState(b.requestId)).approvals === 0, "Dohyeon left waiting");
    await rubric(t, `Host: ${message}\nTool evidence: ${JSON.stringify(turn.toolCalls.map(call => ({ name: call.name, output: call.output })))}`, turn.message,
      "Eunwoo의 요청을 승인했다고 말하되 예약 완료 결과가 없으면 확정됐다고 말하지 않고, read_schedule 결과로 내일 일정을 답한다. Dohyeon의 요청을 승인하거나 거절했다고 말하지 않는다.");
  } },
  { id: "AS-M02", source: "A1 + saved settings change in one message", turns: 1, async test(t) {
    const { host, a, b } = await twoRequests();
    await prepareSavedHost(host);
    const session = await accountSession(t, host.hostAccountId);
    const message = "Dohyeon 거 거절하고, 앞으로 목요일은 미팅 안 받을래";
    const turn = await session.send(message);
    called(t, turn, "decide_requests");
    called(t, turn, "draft_settings");
    check(t, (await requestState(b.requestId)).state === "declined", "Dohyeon declined");
    check(t, (await requestState(a.requestId)).state === "awaiting_host_approval" && (await requestState(a.requestId)).approvals === 0, "Eunwoo left waiting");
    const row = await settings(host.hostAccountId);
    check(t, row !== undefined && row.settings.weeklyWindows.every(window => window.weekday !== "thursday")
      && row.settings.weeklyWindows.some(window => window.weekday === "monday"), "Thursday removed and the other days kept");
    await rubric(t, `Host: ${message}\nTool evidence: ${JSON.stringify(turn.toolCalls.map(call => ({ name: call.name, output: call.output })))}`, turn.message,
      "Dohyeon의 요청을 거절했다고 말하고, 목요일을 미팅 가능 시간에서 뺐다고 말한다. 도구 결과가 저장됐다고 할 때만 저장됐다고 말한다. Eunwoo의 요청을 승인하거나 거절했다고 말하지 않는다.");
  } },
  { id: "AS-M03", source: "two decisions and a schedule question in one message", turns: 1, async test(t) {
    const { host, a, b } = await twoRequests();
    const session = await accountSession(t, host.hostAccountId);
    const message = "Eunwoo 거 승인하고, Dohyeon 거는 거절하고, 다음 주 일정도 보여줘";
    const turn = await session.send(message);
    called(t, turn, "decide_requests");
    called(t, turn, "read_schedule");
    check(t, ["booking", "booked"].includes((await requestState(a.requestId)).state), "Eunwoo approved");
    check(t, (await requestState(b.requestId)).state === "declined", "Dohyeon declined");
    await rubric(t, `Host: ${message}\nTool evidence: ${JSON.stringify(turn.toolCalls.map(call => ({ name: call.name, output: call.output })))}`, turn.message,
      "Eunwoo 승인과 Dohyeon 거절 결과를 각각 말하고, 예약 완료 결과가 없으면 확정됐다고 말하지 않으며, read_schedule 결과로 다음 주 일정을 답한다.");
  } },
];

export default cases.flatMap(entry => Array.from({ length: 3 }, (_, index) => defineEval({
  description: `${entry.id} run ${index + 1}: ${entry.source}`,
  tags: ["account-assistant", "live-model", `case:${entry.id}`],
  metadata: { caseId: entry.id, source: entry.source, trial: index + 1 },
  timeoutMs: 120_000 + entry.turns * 90_000,
  async test(t) { await entry.test(t); t.succeeded(); },
})));
