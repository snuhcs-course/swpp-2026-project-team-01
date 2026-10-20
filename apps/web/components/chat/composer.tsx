"use client";

import { ArrowUpIcon, Loader2Icon, SquareIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getChatMessageLength, MAX_CHAT_MESSAGE_CHARS } from "@lib/contracts/chat-message";
import { cn } from "@/lib/utils";

export function ChatComposer({
  autoFocus = true,
  className,
  disabled = false,
  disabledReason,
  footerStart,
  isBusy = false,
  isPreparing = false,
  maxLength = MAX_CHAT_MESSAGE_CHARS,
  onChange,
  onSubmit,
  placeholder = "Message Thyme",
  value,
}: {
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly footerStart?: ReactNode;
  readonly isBusy?: boolean;
  readonly isPreparing?: boolean;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly onStop: () => void;
  readonly onSubmit: (value: string) => void | Promise<void>;
  readonly placeholder?: string;
  readonly value: string;
}) {
  const composerId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaDisabled = disabled || isBusy || isPreparing;
  const trimmedValue = value.trim();
  const isOverMaxLength = getChatMessageLength(trimmedValue) > maxLength;

  useEffect(() => {
    if (!autoFocus || textareaDisabled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, textareaDisabled]);

  const submitValue = useCallback(() => {
    const text = value.trim();
    if (!text || disabled || isBusy || isPreparing || getChatMessageLength(text) > maxLength) {
      return;
    }

    void onSubmit(text);
  }, [disabled, isBusy, isPreparing, maxLength, onSubmit, value]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitValue();
    },
    [submitValue],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitValue();
      }
    },
    [submitValue],
  );

  // The shadcn/ui Prompt Input pattern: an Input Group with the textarea and a
  // send button in its block-end addon. Enter sends; Shift+Enter adds a line.
  const form = (
    <form className={cn("min-w-0", className)} onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={composerId}>
        Message Thyme
      </label>
      <InputGroup
        className="rounded-xl bg-card shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0"
        data-chat-composer
        data-disabled={textareaDisabled || undefined}
      >
        <InputGroupTextarea
          autoFocus={autoFocus}
          className="max-h-32 min-h-12 px-3 pt-3 pb-1 leading-6 outline-none focus-visible:outline-none disabled:opacity-60 sm:px-4 md:text-base"
          data-chat-composer-input
          disabled={textareaDisabled}
          id={composerId}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          rows={2}
          value={value}
        />
        <InputGroupAddon align="block-end" className="cursor-default justify-between gap-2 pt-1 pb-2 sm:px-4">
          <div className="-ml-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {footerStart ?? <span className="block h-8" />}
          </div>
          {isBusy ? (
            <InputGroupButton
              aria-label="Response in progress"
              className="size-11 cursor-default rounded-full bg-secondary text-muted-foreground hover:bg-secondary disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100"
              disabled
              size="icon-sm"
              variant="secondary"
            >
              <SquareIcon className="size-3 fill-current" />
            </InputGroupButton>
          ) : isPreparing ? (
            <InputGroupButton
              aria-label="Preparing chat"
              className="size-11 rounded-full bg-secondary text-muted-foreground"
              disabled
              size="icon-sm"
              variant="secondary"
            >
              <Loader2Icon className="size-4 animate-spin" />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              aria-label="Send message"
              className="size-11 rounded-full disabled:pointer-events-auto disabled:opacity-40"
              disabled={disabled || trimmedValue.length === 0 || isOverMaxLength}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <ArrowUpIcon className="size-5" />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );

  if (!disabledReason || (!disabled && !isBusy && !isPreparing)) {
    return form;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div aria-label={disabledReason} className="min-w-0" tabIndex={0}>
          {form}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
