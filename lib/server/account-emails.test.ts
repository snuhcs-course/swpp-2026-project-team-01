import { describe, expect, it } from "vitest";
import { confirmationMatches } from "./account-deletion";
import { ACCOUNT_EMAIL_TEMPLATES, dueDate, renderAccountEmail } from "./account-emails";
import { EMAIL_TEMPLATES, renderEmail } from "./email-templates";

const hostAccountId = "00000000-0000-4000-8000-000000000001";

describe("confirmationMatches", () => {
  it("matches the handle ignoring case, spaces and a leading @", () => {
    expect(confirmationMatches("  @Ada-Lovelace ", "ada-lovelace", "ada@example.test")).toBe(true);
    expect(confirmationMatches("ada-lovelace", "ada-lovelace", null)).toBe(true);
  });

  it("refuses another handle, the email when a handle exists, and empty text", () => {
    expect(confirmationMatches("ada", "ada-lovelace", "ada@example.test")).toBe(false);
    expect(confirmationMatches("ada@example.test", "ada-lovelace", "ada@example.test")).toBe(false);
    expect(confirmationMatches("   ", "ada-lovelace", null)).toBe(false);
  });

  it("uses the Google address when the host has no handle", () => {
    expect(confirmationMatches(" Ada@Example.test ", null, "ada@example.test")).toBe(true);
    expect(confirmationMatches("ada", null, "ada@example.test")).toBe(false);
    expect(confirmationMatches("ada@example.test", null, null)).toBe(false);
  });
});

describe("account emails", () => {
  it("are registered as email templates", () => {
    for (const template of ACCOUNT_EMAIL_TEMPLATES) expect(EMAIL_TEMPLATES).toContain(template);
  });

  it("name the due date in UTC and how to cancel, in English and Korean", () => {
    const parameters = { appUrl: "https://findmeatime.com/app", dueAt: "2026-11-23T06:30:00.000Z", hostAccountId };
    const en = renderEmail("account_deletion_scheduled", "en", parameters, {});
    expect(en.subject).toBe("Your account is scheduled for deletion");
    expect(en.text).toContain("23 November 2026 at 06:30 UTC");
    expect(en.text).toContain("Signing in with Google before then cancels it.");
    expect(en.text).toContain("Sign in to keep my account: https://findmeatime.com/app");
    expect(en.html).toContain('href="https://findmeatime.com/app"');

    const ko = renderAccountEmail("account_deletion_scheduled", "ko", parameters);
    expect(ko.subject).toBe("계정 삭제가 예약되었습니다");
    expect(ko.text).toContain(dueDate(parameters.dueAt, "ko"));
    expect(ko.text).toContain("다시 로그인하면 삭제가 취소됩니다");
  });

  it("refuse to render a scheduled email without its due time", () => {
    expect(() => renderAccountEmail("account_deletion_scheduled", "en", { hostAccountId })).toThrow();
  });

  it("tell a guest the host closed their account, without any link", () => {
    const named = renderAccountEmail("host_account_closed", "en", { hostAccountId, hostName: "Ada <b>" });
    expect(named.subject).toBe("Your meeting request with Ada <b> is closed");
    expect(named.html).toContain("Ada &lt;b&gt;");
    expect(named.html).not.toContain("href=");
    expect(named.text).not.toMatch(/https?:/);

    const unnamed = renderAccountEmail("host_account_closed", "ko", { hostAccountId, hostName: null });
    expect(unnamed.subject).toBe("호스트님과의 미팅 요청이 닫혔습니다");
  });

  it("confirm the cancellation with a link to /app and the completion without one", () => {
    const cancelled = renderAccountEmail("account_deletion_cancelled", "en", { appUrl: "https://findmeatime.com/app", hostAccountId });
    expect(cancelled.text).toContain("Open Find Me a Time: https://findmeatime.com/app");
    const completed = renderAccountEmail("account_deletion_completed", "en", { appUrl: "https://findmeatime.com/app", hostAccountId });
    expect(completed.subject).toBe("Your account is deleted");
    expect(completed.html).not.toContain("href=");
  });
});
