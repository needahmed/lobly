import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How LOBLY stores, uses, and protects player and account data.",
};

export default function PrivacyPage() {
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
        <div className="legal-kicker">LEGAL / PRIVACY</div>
        <h1>Privacy Policy</h1>
        <p className="legal-date">Last updated: July 21, 2026</p>
        <h2>Data we store</h2>
        <ul>
          <li>Email address and password hash for LOBLY login</li>
          <li>Riot PUUID, Riot ID, summoner ID, and platform</li>
          <li>Match-derived stats (rank, roles, champions, form)</li>
          <li>Listings, join requests, and session membership</li>
          <li>Session chat (retained up to 7 days)</li>
          <li>Endorsements, reliability events, blocks, and reports</li>
        </ul>
        <h2>What we do not store</h2>
        <p>
          We do not collect real legal names. Discord tags are optional and only
          shared according to your reveal preference. League Client (LCU) port
          and authentication token never leave your machine.
        </p>
        <h2>Purpose</h2>
        <p>
          Data is used to verify profiles, run filters and Match Score, automate
          lobby invites you approve, operate chat and reputation features, and
          improve the reliability of the network.
        </p>
        <h2>Deletion</h2>
        <p>
          You can delete your account via the app (<code>DELETE /v1/users/me</code>
          ) or by emailing{" "}
          <a href="mailto:support@lobly.gg">support@lobly.gg</a>. Deletion removes
          linked Riot accounts, snapshots, listings, chat, and blocks; report rows
          may be retained with the reporter field cleared for moderation integrity.
        </p>
        <h2>Contact</h2>
        <p>
          Privacy questions can be sent to{" "}
          <a href="mailto:privacy@lobly.gg">privacy@lobly.gg</a>.
        </p>
        <nav className="legal-nav" aria-label="Legal pages">
          <a href="/">Home</a>
          <a href="/terms">Terms of Service</a>
        </nav>
      </main>
    </div>
  );
}
