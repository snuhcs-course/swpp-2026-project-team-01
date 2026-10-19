"use client";

import { useCallback, useRef, useState } from "react";
import {
  AgentChatSession,
  type AgentChatController,
  type AgentChatControllerStatus,
} from "@/app/_components/agent-chat";
import { ChatComposer } from "@/components/chat/composer";

const IDLE_CONTROLLER_STATUS: AgentChatControllerStatus = {
  isBusy: false,
  isDisabled: false,
  isEmpty: true,
};

export function AppChatPage() {
  const [draft, setDraft] = useState("");
  const [controllerReady, setControllerReady] = useState(false);
  const [controllerStatus, setControllerStatus] = useState(IDLE_CONTROLLER_STATUS);
  const controllerRef = useRef<AgentChatController | null>(null);

  const handleControllerChange = useCallback(
    (controller: AgentChatController | null, status: AgentChatControllerStatus) => {
      controllerRef.current = controller;
      setControllerReady(Boolean(controller));
      setControllerStatus((current) =>
        current.isBusy === status.isBusy &&
        current.isDisabled === status.isDisabled &&
        current.isEmpty === status.isEmpty
          ? current
          : status,
      );
    },
    [],
  );

  const handleComposerSubmit = useCallback(async (text: string) => {
    await controllerRef.current?.sendMessage(text, {
      clearDraft: () => setDraft(""),
      restoreDraft: setDraft,
    });
  }, []);

  const handleComposerStop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <AgentChatSession activeChat={null} onControllerChange={handleControllerChange} />

      <div className="shrink-0 pb-4 sm:pb-6">
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <ChatComposer
            disabled={!controllerReady || controllerStatus.isDisabled}
            disabledReason={controllerReady ? controllerStatus.disabledReason : "Chat is still getting ready."}
            isBusy={controllerStatus.isBusy}
            onChange={setDraft}
            onStop={handleComposerStop}
            onSubmit={handleComposerSubmit}
            placeholder="Ask anything..."
            value={draft}
          />
        </div>
      </div>
    </main>
  );
}
