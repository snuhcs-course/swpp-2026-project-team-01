// Thyme's profile picture: one character shown wherever Thyme speaks, so the
// web conversations, the landing page and the email signature look like the same
// assistant as the Telegram bot and the iMessage contact card. Browser-safe.
//
// Two characters are drawn; THYME_AVATAR picks the one every surface shows. The
// files live in apps/web/public/thyme: <id>-128.png and <id>-512.png on a
// transparent background for the screens and emails, and <id>-profile.jpg on
// white as the messenger profile photo (npm run telegram:webhook uploads it).

export const THYME_AVATAR_IDS = ["blue", "pink"] as const;

export type ThymeAvatarId = (typeof THYME_AVATAR_IDS)[number];

export const THYME_AVATAR: ThymeAvatarId = "blue";

// The public origin emails load the picture from: a mail client fetches it
// itself, so it must be an absolute URL on the production host.
const PUBLIC_ORIGIN = "https://findmeatime.com";

export function thymeAvatarPath(size: 128 | 512 = 128, id: ThymeAvatarId = THYME_AVATAR) {
  return `/thyme/${id}-${size}.png`;
}

export function thymeAvatarUrl(size: 128 | 512 = 128, id: ThymeAvatarId = THYME_AVATAR) {
  return `${PUBLIC_ORIGIN}${thymeAvatarPath(size, id)}`;
}
