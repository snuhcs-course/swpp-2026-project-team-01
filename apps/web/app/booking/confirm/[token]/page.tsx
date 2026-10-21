import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmAddressForm } from "./confirm-address-form";

// The creation email's **Confirm this address** link (design decision 6).
// Opening it confirms nothing: the page shows a **Confirm this address** button
// whose same-origin POST confirms the address once, while the request is open
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
      <Suspense fallback={<p role="status">Loading...</p>}>
        <Confirmation params={params} />
      </Suspense>
    </main>
  );
}

async function Confirmation({ params }: { readonly params: Params }) {
  return <ConfirmAddressForm token={(await params).token} />;
}
