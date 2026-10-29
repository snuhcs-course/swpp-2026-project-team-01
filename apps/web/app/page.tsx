import type { Metadata } from "next";
import { AgentSection } from "@/app/_components/agent-section";

// The public entry page: what the product is, Google sign-in, and where agents
// find the host instructions (also declared as the Markdown alternate).
export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/SKILL.md" } },
};

const STEPS = [
  {
    body: "One Google screen asks for your identity and Calendar access. They are recorded as separate grants, and you can connect Calendar later.",
    title: "Sign in with Google",
  },
  {
    body: "Thyme, the scheduling assistant, reads your calendars to suggest hours, meeting length and buffers. You confirm every value.",
    title: "Confirm your rules",
  },
  {
    body: "Once setup is confirmed you get a public link. Nothing is booked without your explicit approval.",
    title: "Share your link",
  },
] as const;

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-16 px-4 py-16 sm:px-8 sm:py-24">
      <section className="flex max-w-2xl flex-col gap-6">
        <h1 className="font-display text-[clamp(40px,6vw,72px)] leading-[1.12] tracking-[-0.01em]">Find Me a Time</h1>
        <p className="text-lg text-muted-foreground">
          Let&apos;s find a time. Find Me a Time schedules external one-to-one meetings from your Google Calendar and the
          rules you confirm. Anyone with a Google account can become a host, and people who book with you never need an
          account.
        </p>
        <div>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover active:bg-primary-pressed"
            href="/auth/sign-in"
          >
            Sign in with Google
          </a>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="flex flex-col gap-6">
        <h2 className="font-display text-2xl" id="how-heading">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li className="rounded-xl border border-border bg-card p-6" key={step.title}>
              <p className="font-medium text-muted-foreground text-sm">Step {index + 1}</p>
              <h3 className="mt-1 font-semibold text-lg">{step.title}</h3>
              <p className="mt-2 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <AgentSection href="/SKILL.md">
        Sign-in and setup happen in the browser. A personal agent can connect to the MCP server at /mcp once you allow it in
        the browser; the instructions explain how.
      </AgentSection>

      <footer className="text-sm text-muted-foreground">
        <a className="underline underline-offset-4" href="/privacy">
          Privacy and your data
        </a>
      </footer>
    </main>
  );
}
