import { thymeAvatarUrl } from "../contracts/thyme-avatar";

// The sign-off at the foot of every product email: Thyme's profile picture beside
// "Thyme" and "Find Me a Time", the same character the conversations show. A
// layout table keeps the picture and the words side by side in Outlook; the
// picture is decorative (alt=""), so a client that blocks images still reads the
// sign-off in words.
export function emailSignatureHtml() {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:24px 0 0">`,
    `<tr><td valign="middle" style="padding:0 12px 0 0">`,
    `<img src="${thymeAvatarUrl(128)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:20px;background-color:#F6F7F9">`,
    `</td><td valign="middle" style="font-family:Arial,Helvetica,sans-serif;line-height:18px">`,
    `<span style="display:block;color:#1E2430;font-size:14px;font-weight:700">Thyme</span>`,
    `<span style="display:block;color:#586172;font-size:13px">Find Me a Time</span>`,
    `</td></tr></table>`,
  ].join("");
}
