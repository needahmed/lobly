import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing your use of the LOBLY desktop companion app.",
};

export default function TermsPage() {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <a className="brand" href="/" aria-label="LOBLY home">
          <img src="/lobly-mark.svg" width="34" height="34" alt="" />
          <span>LOBLY</span>
        </a>
        <a href="/">Back to home <span aria-hidden="true">→</span></a>
      </header>
      <main className="legal">
        <div className="legal-kicker">LEGAL / TERMS</div>
        <h1>Terms of Service</h1>
        <p className="legal-date">Last updated: July 21, 2026</p>
        <h2>1. Service</h2>
        <p>
          LOBLY is a desktop companion matchmaking app for League of Legends.
          It helps players publish and join premade lobbies before queue. It
          does not provide information about matchmade opponents and does not
          assist queue dodging.
        </p>
        <h2>2. Accounts</h2>
        <p>
          You must provide a valid email and keep your credentials secure. Riot
          account linking uses the League client on your machine as ownership
          proof. You are responsible for activity on your LOBLY account.
        </p>
        <h2>3. Acceptable use</h2>
        <ul>
          <li>No harassment, hate speech, or bait joins.</li>
          <li>No attempts to bypass filters, rate limits, or bans.</li>
          <li>No scraping of the listing board or player profiles.</li>
        </ul>
        <h2>4. Third-party services</h2>
        <p>
          LOBLY uses Riot Games APIs and local League client services to provide
          account verification and lobby features. Riot Games&apos; applicable
          terms also apply. League of Legends is a trademark of Riot Games;
          LOBLY is not endorsed by Riot Games.
        </p>
        <h2>5. Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a href="mailto:support@lobly.gg">support@lobly.gg</a>.
        </p>
        <nav className="legal-nav" aria-label="Legal pages">
          <a href="/">Home</a>
          <a href="/privacy">Privacy Policy</a>
        </nav>
      </main>
    </div>
  );
}
