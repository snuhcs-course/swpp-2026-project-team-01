// Telegram Bot API update fixtures (host-telegram-channel design 2 and 3), shaped
// as the Bot API documents them, so tests drive the real webhook receiver. The
// fixture is confirmed against a real update at the join (task 5.1).

export const TEST_TELEGRAM_SECRET = "tg_webhook_test_secret_0123456789abcdef";

let nextUpdate = Math.floor(Math.random() * 1e9);

export function newTelegramUpdateId() {
  nextUpdate += 1;
  return nextUpdate;
}

export function newTelegramUser() {
  return 100_000_000 + Math.floor(Math.random() * 1e9);
}

type From = { readonly userId: number; readonly isBot?: boolean; readonly firstName?: string; readonly username?: string };

function from(fixture: From) {
  return { first_name: fixture.firstName ?? "Host", id: fixture.userId, is_bot: fixture.isBot ?? false, language_code: "en", username: fixture.username };
}

export function telegramMessage(fixture: From & { readonly updateId?: number; readonly text?: string; readonly chat?: { id: number; type: string } }) {
  return JSON.stringify({
    message: {
      chat: fixture.chat ?? { first_name: fixture.firstName ?? "Host", id: fixture.userId, type: "private" },
      date: 1_793_000_000,
      from: from(fixture),
      message_id: 10,
      text: fixture.text ?? "requests",
    },
    update_id: fixture.updateId ?? newTelegramUpdateId(),
  });
}

export function telegramCallback(fixture: From & { readonly updateId?: number; readonly data: string; readonly callbackId?: string }) {
  return JSON.stringify({
    callback_query: {
      chat_instance: "-123456789",
      data: fixture.data,
      from: from(fixture),
      id: fixture.callbackId ?? `cb${fixture.userId}`,
      message: { chat: { id: fixture.userId, type: "private" }, date: 1_793_000_000, message_id: 42, text: "Proposal" },
    },
    update_id: fixture.updateId ?? newTelegramUpdateId(),
  });
}

export function telegramBlocked(fixture: From & { readonly updateId?: number }) {
  return JSON.stringify({
    my_chat_member: {
      chat: { id: fixture.userId, type: "private" },
      date: 1_793_000_000,
      from: from(fixture),
      new_chat_member: { status: "kicked", until_date: 0, user: { first_name: "Find Me a Time", id: 1, is_bot: true } },
      old_chat_member: { status: "member", user: { first_name: "Find Me a Time", id: 1, is_bot: true } },
    },
    update_id: fixture.updateId ?? newTelegramUpdateId(),
  });
}

export function telegramDelivery(body: string, secret: string | null = TEST_TELEGRAM_SECRET) {
  return new Request("http://localhost:2000/telegram/webhook", {
    body,
    headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }) },
    method: "POST",
  });
}
