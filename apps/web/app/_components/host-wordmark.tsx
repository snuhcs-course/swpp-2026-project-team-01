import Link from "next/link";

// The wordmark atop every signed-in host page: the page's heading, and a link
// home to the workspace at /app rather than the public landing.
export function HostWordmark({ className }: { readonly className?: string }) {
  return (
    <h1 className={className}>
      <Link className="wordmark-lockup" href="/app">
        Find Me a Time
      </Link>
    </h1>
  );
}
