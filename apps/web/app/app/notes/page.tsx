import { openHostWorkspace } from "@lib/server/web-session";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LOCALE_COOKIE, localeOf } from "@/app/_components/ink/copy";
import { NoteReviewPanel } from "@/app/_components/notes/note-review-panel";
import { SignInCard, WorkspaceLoading } from "@/app/_components/sign-in-card";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";

// The note review page (calendar-note-review design 7): the link the chat
// onboarding sends, the weekly check and the settings open it. Signed out, it
// offers Google sign-in like /app.

export default function Page() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <NotesPage />
    </Suspense>
  );
}

async function NotesPage() {
  await connection();
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const standing = await openHostWorkspace(cookie);

  if (!standing || standing.nextAction === "sign_in") return <SignInCard notice={null} />;

  const locale = localeOf(jar.get(LOCALE_COOKIE)?.value);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[960px] flex-col gap-6 px-4 py-6" lang={locale}>
      <div className="flex items-center justify-between">
        <Link className="wordmark-lockup" href="/app">
          Find Me a Time
        </Link>
        <WorkspaceMenu />
      </div>
      {standing.eligible ? (
        <section aria-labelledby="note-review-title" className="flex flex-col gap-4 rounded-3xl bg-card px-5 py-5 text-card-foreground">
          <NoteReviewPanel headingId="note-review-title" locale={locale} />
        </section>
      ) : (
        <p>This host account is suspended, so the workspace is unavailable. Contact support to restore it.</p>
      )}
    </main>
  );
}
