export default function Home() {
  return <main className="landing">
    <a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a>
    <div className="intro">
      <p className="eyebrow">A little less back and forth</p>
      <h1>Make room for<br />a good conversation.</h1>
      <p className="description">An assistant that finds a time, works through the details, and keeps your final say.</p>
      <a className="primary-button landing-action" href="/app">Open your host workspace <span aria-hidden="true">↗</span></a><p className="release-note">Hosting is opening by invitation. Join the waitlist or sign in to check your access.</p>
    </div>
    <footer>Thoughtful scheduling. One meeting at a time.</footer>
  </main>;
}
