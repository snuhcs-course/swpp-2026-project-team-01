// The one unavailable page for every unknown, invalid, released, unready or
// suspended address; it says nothing about why.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
      <a className="wordmark-lockup self-start" href="/">
        Find Me a Time
      </a>
      <main className="flex w-full max-w-xl flex-1 flex-col justify-center gap-5 py-16">
        <h1 className="font-display text-[clamp(48px,8vw,96px)] leading-[0.96]">Not available</h1>
        <p className="text-lg text-body">Nothing is available at this address. Check the link with the person who shared it.</p>
        <a className="self-start text-sm font-medium text-primary underline underline-offset-4" href="/">
          Find Me a Time home
        </a>
      </main>
    </div>
  );
}
