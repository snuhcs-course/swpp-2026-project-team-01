import { confirmContact } from "@lib/server/contact-confirmation";
import { database } from "@lib/server/database";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

// The creation email's **Confirm this address** link (design decision 6).
// Opening it in any browser confirms the address once, while the request is open
// and its contact still equals the address; any other token gets the same
// neutral answer. The token is a credential, so the page is never indexed, never
// cached and never sent as a referrer (next.config.ts sets the same headers).
type Params = Promise<{ token: string }>;

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Confirm your address",
};

export default function Page({ params }: { readonly params: Params }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <Suspense fallback={<p role="status">Confirming your address...</p>}>
        <Confirmation params={params} />
      </Suspense>
    </main>
  );
}

async function Confirmation({ params }: { readonly params: Params }) {
  await connection();
  const outcome = await confirmContact(database(), (await params).token);

  if (outcome === "confirmed") {
    return (
      <section aria-labelledby="confirm-title" className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight" id="confirm-title">
          Address confirmed
        </h1>
        <p>Thanks. Your email address is confirmed for this meeting request. You can close this page.</p>
        <p className="text-muted-foreground text-sm">To continue the request, open the booking link from the same email.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="confirm-title" className="flex flex-col gap-2">
      <h1 className="font-display text-3xl leading-tight" id="confirm-title">
        This confirmation link is not available
      </h1>
      <p>
        It may have been used already, or a newer email replaced it. Use the latest email we sent, or open your booking
        link to send a new one.
      </p>
    </section>
  );
}
