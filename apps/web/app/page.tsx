import {IdentityReturnNotice} from '../components/identity-return-notice.tsx';
import {WaitlistForm} from '../components/waitlist-form.tsx';
export default function Home() {
  return <main className="landing">
    <a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a>
    <div className="intro"><IdentityReturnNotice/>
      <p className="eyebrow">A little less back and forth</p>
      <h1>Make room for<br />a good conversation.</h1>
      <p className="description">An assistant that finds a time, works through the details, and keeps your final say.</p>
      <a className="primary-button landing-action" href="/app">Open your host workspace <span aria-hidden="true">↗</span></a><p className="release-note">Hosting is opening by invitation. Join the waitlist or sign in to check your access.</p>
    </div>
    <section id="waitlist" className="landing-waitlist" aria-labelledby="waitlist-heading">
      <div><p className="eyebrow">Become a host</p><h2 id="waitlist-heading">Your next good conversation starts here.</h2><p className="description">Join the waitlist for an invitation to host. You can join without signing in or connecting a calendar.</p></div>
      <WaitlistForm/>
    </section>
    <footer>Thoughtful scheduling. One meeting at a time.</footer>
  </main>;
}
