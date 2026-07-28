"use client";

import { useEffect, useState, type ReactNode } from "react";

const DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_LOBLY_DOWNLOAD_URL ??
  "https://download.lobly.gg/windows/latest";

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "download"
  | "headset"
  | "lock"
  | "radar"
  | "roles"
  | "shield"
  | "spark"
  | "users"
  | "verified"
  | "windows";

const ICON_PATHS: Record<IconName, ReactNode> = {
  arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  headset: (
    <>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <path d="M4 13h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 12 18 6M3 12h2m14 0h2M12 3v2m0 14v2" />
    </>
  ),
  roles: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="m4 19 16-14M9 5v5H4m11 9v-5h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 2.8 7.6 7 10 4.2-2.4 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  spark: <path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Zm7 14 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19v-1c0-3 2.7-5 6-5s6 2 6 5v1" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5m1 2c2.4.5 4 2.2 4 4.5V19h-3" />
    </>
  ),
  verified: (
    <>
      <path d="m12 2 2.2 2 3-.2.7 2.9 2.5 1.7-1.2 2.8 1.2 2.8-2.5 1.7-.7 2.9-3-.2-2.2 2-2.2-2-3 .2-.7-2.9L3.6 14l1.2-2.8-1.2-2.8 2.5-1.7.7-2.9 3 .2L12 2Z" />
      <path d="m8.5 11.5 2.2 2.2 4.8-5" />
    </>
  ),
  windows: <path d="M3 5.5 10.5 4v7H3V5.5Zm8.5-1.7L21 2v9h-9.5V3.8ZM3 12h7.5v7L3 17.5V12Zm8.5 0H21v10l-9.5-1.8V12Z" />,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#top" aria-label="LOBLY home">
      <img src="/lobly-mark.svg" width="34" height="34" alt="" />
      {!compact && <span>LOBLY</span>}
    </a>
  );
}

function DownloadButton({
  className = "",
  children = "Download for Windows",
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a className={`button button-primary ${className}`} href={DOWNLOAD_URL}>
      <Icon name="windows" size={17} />
      <span>{children}</span>
      <Icon name="arrow" size={17} />
    </a>
  );
}

function MatchScore({ value = 94, size = "large" }: { value?: number; size?: "small" | "large" }) {
  return (
    <div className={`match-score match-score-${size}`} style={{ "--score": value } as React.CSSProperties}>
      <div className="match-score-inner">
        <strong>{value}</strong>
        <span>match</span>
      </div>
    </div>
  );
}

function RoleGlyph({ role }: { role: "top" | "jungle" | "mid" | "bot" | "support" }) {
  const paths = {
    top: "M4 20V4h16v4h-2V6H6v12h4v2H4zm6-6h10v6H10v-6zm2 2v2h6v-2h-6z",
    jungle:
      "M12 2c1.5 3 1 5-1 7 3-1 4-3 4-3s1 4-2 7c-1.6 1.6-3 2-3 2v5h-2v-5s-2-.6-3.4-2C4 12 5 8 5 8s1 2 4 3c-2-2-2.5-4-1-7 1 2 2.5 3 4 4 0-2-.5-4 0-6z",
    mid: "M4 20 20 4h-6V2h8v8h-2V6L4 22v-2z",
    bot: "M20 4v16H4v-4h2v2h12V6h-2V4h4zM4 4h10v10H4V4zm2 2v6h6V6H6z",
    support: "M12 21s-8-4.5-8-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-8 10-8 10z",
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paths[role]} />
    </svg>
  );
}

function AppPreview() {
  return (
    <div className="app-preview" aria-label="LOBLY product preview">
      <div className="window-glow" />
      <div className="app-titlebar">
        <Logo compact />
        <div className="window-title">Find Team</div>
        <div className="client-state">
          <span />
          League connected
        </div>
        <div className="window-controls">
          <i />
          <i />
        </div>
      </div>
      <div className="app-body">
        <aside className="app-sidebar">
          <div className="sidebar-item active">
            <Icon name="radar" size={16} />
            <span>Find Team</span>
          </div>
          <div className="sidebar-item">
            <Icon name="users" size={16} />
            <span>My Lobby</span>
          </div>
          <div className="sidebar-item">
            <Icon name="spark" size={16} />
            <span>Requests</span>
            <b>2</b>
          </div>
          <div className="sidebar-item">
            <Icon name="headset" size={16} />
            <span>Session</span>
          </div>
          <div className="sidebar-status">
            <span />
            <div>
              <strong>LOBLY network</strong>
              <small>Online</small>
            </div>
          </div>
        </aside>
        <div className="app-content">
          <div className="filter-row">
            <span>Ranked Solo/Duo <Icon name="chevron" size={13} /></span>
            <span>My rank range <Icon name="chevron" size={13} /></span>
            <span>Voice on</span>
            <span className="filter-results">24 live lobbies</span>
          </div>
          <LobbyRow
            featured
            initials="NV"
            name="NovaVow"
            tag="EUW"
            rank="Diamond II"
            role="support"
            score={94}
            title="Clean comms · climbing to Master"
            tags={["English", "Discord", "Reliable 98"]}
          />
          <LobbyRow
            initials="OR"
            name="OrbitRush"
            tag="EUW"
            rank="Emerald I"
            role="jungle"
            score={87}
            title="Aggressive early game duo"
            tags={["English", "League voice", "15m left"]}
          />
          <LobbyRow
            initials="AY"
            name="AfterYou"
            tag="EUW"
            rank="Diamond IV"
            role="mid"
            score={81}
            title="Chill games, serious climb"
            tags={["English", "No voice", "Reliable 91"]}
          />
        </div>
      </div>
      <div className="preview-caption">
        <span>Product preview</span>
        <span>Example player data</span>
      </div>
    </div>
  );
}

function LobbyRow({
  featured = false,
  initials,
  name,
  tag,
  rank,
  role,
  score,
  title,
  tags,
}: {
  featured?: boolean;
  initials: string;
  name: string;
  tag: string;
  rank: string;
  role: "top" | "jungle" | "mid" | "bot" | "support";
  score: number;
  title: string;
  tags: string[];
}) {
  return (
    <article className={`lobby-row ${featured ? "featured" : ""}`}>
      <div className="avatar">{initials}</div>
      <div className="lobby-info">
        <div className="lobby-title">
          <strong>{title}</strong>
          {featured && <span className="best-match">Best match</span>}
        </div>
        <div className="player-line">
          <b>{name}</b>
          <span>#{tag}</span>
          <i />
          <span className="verified-text"><Icon name="verified" size={13} /> Verified</span>
          <i />
          <span className="rank">{rank}</span>
          <span className="role"><RoleGlyph role={role} /> {role}</span>
        </div>
        <div className="tag-line">
          {tags.map((item) => <span key={item}>{item}</span>)}
        </div>
      </div>
      <MatchScore value={score} size="small" />
      <span className="join-button">Request</span>
    </article>
  );
}

function ProfileShowcase() {
  return (
    <div className="profile-showcase">
      <div className="profile-aurora" />
      <div className="profile-top">
        <div className="profile-avatar">
          NV
          <span><Icon name="verified" size={14} /></span>
        </div>
        <div className="profile-identity">
          <p>VERIFIED PLAYER</p>
          <h3>NovaVow <span>#EUW</span></h3>
          <div className="profile-tags">
            <span>Diamond II · 62 LP</span>
            <span><RoleGlyph role="support" /> Support main</span>
          </div>
        </div>
        <MatchScore />
      </div>
      <div className="profile-stats">
        <div><small>RECENT FORM</small><strong className="green">64%</strong><span>last 20 games</span></div>
        <div><small>RELIABILITY</small><strong>98</strong><span>42 sessions</span></div>
        <div><small>CURRENT STREAK</small><strong className="cyan">+4</strong><span>wins</span></div>
      </div>
      <div className="champion-pool">
        <div className="champion-copy">
          <small>TOP CHAMPIONS</small>
          <strong>Proven champion pool</strong>
        </div>
        {[
          ["TH", "Thresh", "58%"],
          ["RE", "Rell", "61%"],
          ["NA", "Nami", "55%"],
        ].map(([short, name, wr], index) => (
          <div className={`champion champion-${index + 1}`} key={name}>
            <span>{short}</span>
            <div><b>{name}</b><small>{wr} win rate</small></div>
          </div>
        ))}
      </div>
      <div className="endorsements">
        <span><Icon name="headset" size={15} /> 31 Good Comms</span>
        <span><Icon name="users" size={15} /> 38 Good Teammate</span>
        <span><Icon name="spark" size={15} /> 24 Skilled</span>
      </div>
    </div>
  );
}

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`reveal ${className}`}>{children}</div>;
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell" id="top">
      <div className="page-grid" />
      <div className="orb orb-one" />
      <div className="orb orb-two" />

      <header className="site-header">
        <div className="nav-wrap">
          <Logo />
          <button
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span />
            <span />
          </button>
          <nav className={menuOpen ? "nav-links open" : "nav-links"} aria-label="Main navigation">
            <a href="#why" onClick={closeMenu}>Why LOBLY</a>
            <a href="#how" onClick={closeMenu}>How it works</a>
            <a href="#trust" onClick={closeMenu}>Trust</a>
            <a href="#modes" onClick={closeMenu}>Game modes</a>
          </nav>
          <DownloadButton className="nav-download">Get early access</DownloadButton>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-noise" />
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" />
              THE SOCIAL LAYER LEAGUE HAS BEEN MISSING
            </div>
            <h1 id="hero-title">
              Find players worth
              <span> queuing again with.</span>
            </h1>
            <p className="hero-lead">
              LOBLY matches you with verified League players who fit your rank,
              role, language, and vibe—then brings everyone into the same lobby
              without the name-copying ritual.
            </p>
            <div className="hero-actions">
              <DownloadButton />
              <a className="button button-secondary" href="#product">
                See LOBLY in action
                <Icon name="arrow" size={17} />
              </a>
            </div>
            <div className="hero-fineprint">
              <span><Icon name="check" size={14} /> Windows early access</span>
              <span><Icon name="shield" size={14} /> Verified Riot data</span>
              <span><Icon name="lock" size={14} /> Free for players</span>
            </div>
          </div>
          <div className="hero-visual" id="product">
            <div className="floating-card floating-card-one">
              <span className="mini-icon"><Icon name="spark" size={16} /></span>
              <div><small>BEST MATCH</small><strong>94 compatibility</strong></div>
            </div>
            <div className="floating-card floating-card-two">
              <span className="mini-icon cyan"><Icon name="verified" size={16} /></span>
              <div><small>PROFILE CHECK</small><strong>Riot verified</strong></div>
            </div>
            <AppPreview />
          </div>
          <div className="hero-scroll"><span /> Scroll to explore</div>
        </section>

        <section className="signal-strip" aria-label="LOBLY product principles">
          <div>
            <span className="signal-number">01</span>
            <p><strong>Real players.</strong> Every rank and role comes from match data.</p>
          </div>
          <div>
            <span className="signal-number">02</span>
            <p><strong>Live lobbies.</strong> Closed lobbies disappear automatically.</p>
          </div>
          <div>
            <span className="signal-number">03</span>
            <p><strong>One clean flow.</strong> Discover, request, accept, queue.</p>
          </div>
        </section>

        <section className="statement section-pad" id="why">
          <Reveal>
            <div className="section-kicker"><span>THE DIFFERENCE</span></div>
            <h2>Stats tell you who someone was.<br /><em>LOBLY finds who you should play with.</em></h2>
            <p>
              Stop gambling your LP on random LFG posts and self-reported ranks.
              LOBLY turns real account data into better premades before the queue even starts.
            </p>
          </Reveal>
        </section>

        <section className="feature-stage section-pad">
          <Reveal className="feature-copy">
            <div className="feature-index">01 / DISCOVER</div>
            <h2>Your best lobby rises to the top.</h2>
            <p>
              A personalized Match Score ranks every live lobby by role fit, rank
              proximity, language, and shared play preferences. Less browsing.
              Better teammates.
            </p>
            <ul className="check-list">
              <li><span><Icon name="check" size={14} /></span> Rank and role filters verified server-side</li>
              <li><span><Icon name="check" size={14} /></span> Best matches sorted automatically</li>
              <li><span><Icon name="check" size={14} /></span> Only lobbies on your server and shard</li>
            </ul>
          </Reveal>
          <Reveal className="score-visual">
            <div className="score-orbit orbit-a" />
            <div className="score-orbit orbit-b" />
            <div className="score-core">
              <MatchScore value={94} />
              <strong>Exceptional fit</strong>
              <span>Role + Rank + Language</span>
            </div>
            <div className="score-factor factor-one"><i>+32</i><span>Role complement</span></div>
            <div className="score-factor factor-two"><i>+28</i><span>Rank proximity</span></div>
            <div className="score-factor factor-three"><i>+22</i><span>Language match</span></div>
            <div className="score-factor factor-four"><i>+12</i><span>Reliability</span></div>
          </Reveal>
        </section>

        <section className="profile-section section-pad" id="trust">
          <Reveal className="profile-copy">
            <div className="feature-index">02 / KNOW YOUR TEAMMATE</div>
            <h2>No bios. No bluffing. Just the player.</h2>
            <p>
              LOBLY builds a living profile from real Riot data—rank, true roles,
              champion pool, recent form, and a reputation earned only by playing
              through LOBLY.
            </p>
            <div className="metric-pair">
              <div><strong>3 axes</strong><span>Comms · Teammate · Skilled</span></div>
              <div><strong>1 score</strong><span>Reliability, not KDA</span></div>
            </div>
          </Reveal>
          <Reveal><ProfileShowcase /></Reveal>
        </section>

        <section className="how-section section-pad" id="how">
          <Reveal className="section-heading centered">
            <div className="section-kicker"><span>FROM OPEN TO FULL</span></div>
            <h2>Your duo. Three moves away.</h2>
            <p>LOBLY handles the awkward parts so you can get to the good part.</p>
          </Reveal>
          <div className="steps">
            {[
              {
                number: "01",
                icon: "radar" as IconName,
                title: "Create or discover",
                copy: "Publish your current League lobby in seconds, or browse teammates matched to your profile.",
                meta: "Queue, party size, and slots auto-detected",
              },
              {
                number: "02",
                icon: "verified" as IconName,
                title: "Request with confidence",
                copy: "See the full verified player card and compatibility score before anyone joins.",
                meta: "Filters checked against real data",
              },
              {
                number: "03",
                icon: "users" as IconName,
                title: "Land in one lobby",
                copy: "Accept the request and LOBLY sends the League invite. No friend request. No typo.",
                meta: "Ready to queue in moments",
              },
            ].map((step, index) => (
              <Reveal className="step-card" key={step.number}>
                <div className="step-top">
                  <span>{step.number}</span>
                  <i><Icon name={step.icon} size={24} /></i>
                </div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
                <small><Icon name="check" size={13} /> {step.meta}</small>
                {index < 2 && <div className="step-connector"><Icon name="arrow" size={16} /></div>}
              </Reveal>
            ))}
          </div>
        </section>

        <section className="modes-section section-pad" id="modes">
          <Reveal className="section-heading">
            <div className="section-kicker"><span>YOUR QUEUE, YOUR PEOPLE</span></div>
            <h2>Built for more than one kind of night.</h2>
          </Reveal>
          <div className="mode-grid">
            {[
              ["RANKED SOLO / DUO", "Find the role, rank, and mindset that complements your climb.", "bot", "Live"],
              ["RANKED FLEX", "Fill every open position with players who actually belong there.", "roles", "Live"],
              ["ARAM", "Low-friction lobbies for chill runs, streaks, and late-night queues.", "spark", "Live"],
              ["CLASH", "Build a balanced roster around tier, role coverage, and availability.", "shield", "Next"],
              ["CUSTOMS", "Organize scrims, in-houses, and ten-player sessions without chaos.", "users", "Next"],
              ["PRACTICE", "Find focused partners for lane drills, coaching, and replay reviews.", "radar", "Next"],
            ].map(([title, copy, icon, state]) => (
              <Reveal className={`mode-card ${state === "Next" ? "mode-next" : ""}`} key={title}>
                <div className="mode-icon">
                  {icon === "bot" ? <RoleGlyph role="bot" /> : <Icon name={icon as IconName} size={22} />}
                </div>
                <span className="mode-state">{state}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
                <div className="mode-arrow"><Icon name="arrow" size={18} /></div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="trust-banner section-pad">
          <Reveal className="trust-panel">
            <div className="trust-emblem">
              <Icon name="shield" size={34} />
              <span />
            </div>
            <div className="trust-content">
              <div className="feature-index">BUILT FOR TRUST</div>
              <h2>No ghost lobbies. No bought credibility.</h2>
              <p>
                Listings pause when champion select starts and disappear when the
                lobby closes. Reliability reflects whether players show up and
                finish sessions—not whether they carry.
              </p>
            </div>
            <div className="trust-points">
              <span><Icon name="clock" size={18} /> Live-state listings</span>
              <span><Icon name="verified" size={18} /> Verified profiles</span>
              <span><Icon name="shield" size={18} /> Block and report tools</span>
              <span><Icon name="lock" size={18} /> Server-side filters</span>
            </div>
          </Reveal>
        </section>

        <section className="final-cta section-pad" id="download">
          <div className="cta-grid" />
          <div className="cta-orb" />
          <Reveal>
            <img src="/lobly-mark.svg" width="64" height="64" alt="" />
            <div className="section-kicker"><span>YOUR NEXT DUO IS OUT THERE</span></div>
            <h2>Queue less randomly.</h2>
            <p>Download LOBLY for Windows and turn “one more game” into the start of a real partnership.</p>
            <DownloadButton>Get LOBLY early access</DownloadButton>
            <small>Windows 10/11 · Early access build · Free</small>
          </Reveal>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-main">
          <div>
            <Logo />
            <p>Verified teammates. Real lobbies. Better queues.</p>
          </div>
          <div className="footer-links">
            <div>
              <strong>PRODUCT</strong>
              <a href="#why">Why LOBLY</a>
              <a href="#how">How it works</a>
              <a href="#modes">Game modes</a>
            </div>
            <div>
              <strong>LEGAL</strong>
              <a href="/terms">Terms of Service</a>
              <a href="/privacy">Privacy Policy</a>
              <a href="mailto:support@lobly.gg">Contact</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 LOBLY. Built for players who queue together.</span>
          <span>
            LOBLY is not endorsed by Riot Games and does not reflect the views or
            opinions of Riot Games or anyone officially involved in producing or
            managing League of Legends.
          </span>
        </div>
      </footer>
    </div>
  );
}
