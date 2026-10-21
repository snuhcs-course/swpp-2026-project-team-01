// The one unavailable page for every unknown, invalid, released, unready or
// suspended address; it says nothing about why.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="font-display text-3xl">Not available</h1>
      <p className="text-muted-foreground">Nothing is available at this address. Check the link with the person who shared it.</p>
      <a className="text-primary underline underline-offset-4" href="/">
        Find Me a Time home
      </a>
    </main>
  );
}
