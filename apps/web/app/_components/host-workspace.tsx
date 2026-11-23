"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HostRequests } from "@/app/_components/host/host-requests";
import { IMESSAGE_CARD_ID, ImessageCard, rememberedLater, rememberLater } from "@/app/_components/imessage/imessage-card";
import { SetupCards } from "@/app/_components/setup/setup-cards";
import { SetupProvider, useSetupController } from "@/app/_components/setup/setup-context";
import { focusCard } from "@/app/_components/setup/card";
import { WorkspaceMenu } from "@/app/_components/workspace-menu";
import { HostSettingsDialog } from "@/app/_components/host-settings-dialog";
import { Button } from "@/components/ui/button";
import { HostWordmark } from "@/app/_components/host-wordmark";

// The host workspace at /app: a centered column and a compact menu, with no
// sidebar and no chat with Thyme. The host talks to Thyme only in their linked
// messenger, setup included (remove-host-web-chat); a host whose setup is
// incomplete is sent to link one first (LinkStep), and if they reach this page
// they are pointed back to the messenger. This column shows a ready host's open
// card (the share links and the sample request offer) and the messaging card. The menu's Requests item, or
// `?request={requestId}`, opens the request inbox and a request's view in the
// same column instead (host-review-and-booking design 3).

// The messaging card (H11) follows the share links once setup is ready, until
// the host links or chooses Maybe later, which this browser remembers;
// `?view=imessage` opens it at any step. An incomplete host always sees it.

export function HostWorkspace({ dashboardAvailable = false }: { readonly dashboardAvailable?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const request = params.get("request");
  const inbox = params.get("view") === "requests" || request !== null;
  const openRequests = useCallback(() => router.push("/app?view=requests"), [router]);
  const openDashboard = useCallback(() => router.push("/app?view=dashboard"), [router]);

  if (inbox) {
    return <HostRequests onOpenDashboard={dashboardAvailable ? openDashboard : undefined} request={request} />;
  }

  return <SetupWorkspace initialImessageOpen={params.get("view") === "imessage"} onOpenDashboard={dashboardAvailable ? openDashboard : undefined} onOpenRequests={openRequests} />;
}

function SetupWorkspace({ initialImessageOpen, onOpenDashboard, onOpenRequests }: { readonly initialImessageOpen: boolean; readonly onOpenDashboard?: () => void; readonly onOpenRequests: () => void }) {
  const setup = useSetupController();
  const reloadSetup = setup.reload;

  useEffect(() => {
    void reloadSetup();
  }, [reloadSetup]);

  const [imessageLater, setImessageLater] = useState(false);
  const [imessageOpened, setImessageOpened] = useState(initialImessageOpen);
  useEffect(() => setImessageLater(rememberedLater()), []);
  useEffect(() => {
    if (initialImessageOpen) focusCard(IMESSAGE_CARD_ID);
  }, [initialImessageOpen]);

  const setupState = setup.state;
  const setupValue = setup.value;
  const ready = setupState?.nextAction === "ready";
  // Only a ready host's cards (the share links and the sample request offer)
  // show here; an incomplete host finishes setup with Thyme in the messenger.
  const showSetup = setupValue !== null && ready;
  const handoff = setupState !== null && !ready;
  const showImessage = imessageOpened || handoff || (showSetup && !setupState!.tutorialOffered && !imessageLater);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <HostWordmark className="min-w-0" />
        <div className="flex items-center"><HostSettingsDialog /><WorkspaceMenu onSelectDashboard={onOpenDashboard} onSelectRequests={onOpenRequests} /></div>
      </header>

      <main aria-label="Workspace" className="min-h-0 flex-1 overflow-y-auto">
        {setup.loadError && !setupState ? <ErrorNotice message={setup.loadError} onRetry={() => void reloadSetup()} /> : null}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-2 pb-8 sm:px-6">
          <SetupProvider value={setupValue}>
            {handoff ? (
              <section aria-labelledby="setup-handoff-heading" className="flex flex-col gap-2 rounded-3xl bg-card p-5" role="region">
                <h2 className="text-lg font-semibold" id="setup-handoff-heading">Finish setup with Thyme in your messaging app</h2>
                <p className="text-sm text-muted-foreground">
                  Setup happens in conversation with Thyme in iMessage or Telegram. Connect one below if you have not yet. Your settings, requests and dashboard stay here.
                </p>
              </section>
            ) : null}
            {showSetup ? (
              <div aria-label="Setup" className="flex min-w-0 flex-col" role="group">
                <SetupCards />
              </div>
            ) : null}
            {showImessage ? (
              <ImessageCard
                onLater={
                  handoff
                    ? undefined
                    : () => {
                        rememberLater();
                        setImessageLater(true);
                        setImessageOpened(false);
                      }
                }
              />
            ) : null}
          </SetupProvider>
        </div>
      </main>
    </div>
  );
}

// A failed setup load keeps a way to try again, since nothing else on the page
// would reload it.
function ErrorNotice({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-2 sm:px-6" role="alert">
      <div className="flex items-start gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--destructive)_8%,var(--surface))] p-4 text-sm">
        <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1">{message}</p>
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Try again
        </Button>
      </div>
    </div>
  );
}
