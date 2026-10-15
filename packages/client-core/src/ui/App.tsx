import { useEffect, useState, type ReactNode } from "react";
import { ListingStatus } from "@lobly/shared-types";
import { useAppStore } from "../shared/messaging";
import { getBridge, type WindowControls } from "../shared/bridge";
import { c, gradient, radius, GLOBAL_CSS, font } from "./theme";
import { Avatar, BrandMark, IconButton, Tag } from "./components";
import { ProfileView } from "./ProfileView";
import { BoardView } from "./BoardView";
import { ListingView, RequestsView, SessionView } from "./LobbyViews";
import { SettingsView } from "./SettingsView";
import { SignInGate } from "./SignInGate";
import { PostGameBanner, PostGameView } from "./PostGameView";
import { profileIcon, useStaticData } from "./useStaticData";

type Tab = "board" | "listing" | "requests" | "session" | "profile" | "settings" | "postgame";

const NAV: {
  id: Exclude<Tab, "debug">;
  label: string;
  eyebrow: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "board",
    label: "Find Team",
    eyebrow: "Squad Finder",
    description: "Discover verified players who fit your roles, rank and playstyle.",
    icon: "M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z",
  },
  {
    id: "listing",
    label: "My Lobby",
    eyebrow: "Party Control",
    description: "Broadcast your live League lobby and shape the team you want.",
    icon: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  },
  {
    id: "requests",
    label: "Requests",
    eyebrow: "Team Selection",
    description: "Review compatible players before they enter your lobby.",
    icon: "M12 2a5 5 0 015 5 5 5 0 01-5 5 5 5 0 01-5-5 5 5 0 015-5zm0 12c4.4 0 8 1.8 8 4v2H4v-2c0-2.2 3.6-4 8-4z",
  },
  {
    id: "session",
    label: "Session",
    eyebrow: "Premade Channel",
    description: "Coordinate with your squad and recognize great teammates.",
    icon: "M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z",
  },
  {
    id: "profile",
    label: "Profile",
    eyebrow: "Performance Command",
    description: "Your ranked identity, recent momentum and competitive signature.",
    icon: "M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5z",
  },
];

export function App() {
  const state = useAppStore();
  const bridge = getBridge();
  const sd = useStaticData();
  const tab = (isTab(state.uiTab) ? state.uiTab : "profile") as Tab;
  const setTab = (next: Tab) => {
    if (bridge?.navigate) bridge.navigate(next);
    else bridge?.store.update({ uiTab: next });
  };
  const pending = (state.pendingRequests?.length ?? 0) + (state.outgoingRequests?.length ?? 0);
  const [syncDownMs, setSyncDownMs] = useState(0);
  const windowControls = bridge?.windowControls;
  const activeMeta =
    tab === "postgame"
      ? {
          label: "Post-game",
          eyebrow: "Match Recap",
          description: "Review the game you just played and endorse your teammates.",
        }
      : (NAV.find((n) => n.id === tab) ??
        ({
          label: "Settings",
          eyebrow: "Preferences",
          description: "Matchmaking, accounts, privacy and diagnostics.",
        } as const));

  useEffect(() => {
    return bridge?.onNavigate?.((next) => {
      if (isTab(next)) bridge.store.update({ uiTab: next });
    });
  }, [bridge]);

  useEffect(() => {
    if (state.sync.connected) {
      setSyncDownMs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setSyncDownMs(Date.now() - started), 500);
    return () => window.clearInterval(id);
  }, [state.sync.connected]);

  const needsGate =
    state.authChecked &&
    (state.authExpired || state.accountMismatch || (!state.authenticated && !state.hasStoredSession));

  // One global stylesheet for the whole app (resets, scrollbars, keyframes).
  useEffect(() => {
    const id = "lobly-global-css";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);

  return (
    <div
      style={{
        height: "100%",
        background: c.bg,
        color: c.text,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {windowControls && <DesktopTitleBar controls={windowControls} />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: "50%",
            right: -240,
            top: -250,
            background: "rgba(64,111,255,.08)",
            filter: "blur(80px)",
            pointerEvents: "none",
          }}
        />

        <aside
          style={{
            width: 92,
            flexShrink: 0,
            borderRight: `1px solid ${c.border}`,
            background: "linear-gradient(180deg, rgba(10,17,28,.98), rgba(5,9,16,.98))",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "18px 10px 14px",
            zIndex: 2,
            boxShadow: "14px 0 42px rgba(0,0,0,.16)",
          }}
        >
          <BrandMark size={42} />
          <div
            style={{
              width: 24,
              height: 1,
              margin: "18px 0 14px",
              background: `linear-gradient(90deg, transparent, ${c.borderStrong}, transparent)`,
            }}
          />

          <nav
            aria-label="Primary navigation"
            style={{ width: "100%", display: "flex", flexDirection: "column", gap: 7 }}
          >
            {NAV.map((n) => (
              <NavButton
                key={n.id}
                label={n.label}
                icon={n.icon}
                active={tab === n.id}
                badge={n.id === "requests" ? pending : 0}
                onClick={() => setTab(n.id)}
              />
            ))}
          </nav>

          <div style={{ marginTop: "auto", width: "100%", display: "grid", gap: 10 }}>
            <ConnectionBeacon
              league={state.lcu.connected}
              server={state.sync.connected}
              title={`League ${state.lcu.connected ? "connected" : "offline"} · LOBLY ${
                state.sync.connected ? "online" : "offline"
              }`}
            />
            <button
              className="lobly-nav-button"
              onClick={() => setTab("settings")}
              title="Settings"
              style={{
                width: "100%",
                minHeight: 48,
                border: "1px solid transparent",
                background: tab === "settings" ? c.primarySoft : "transparent",
                borderRadius: radius.lg,
                color: tab === "settings" ? c.primary : c.textFaint,
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg width={19} height={19} viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.4 13a7.7 7.7 0 000-2l2.1-1.6-2-3.5-2.6 1a8 8 0 00-1.7-1L14.8 3h-4l-.4 2.8a8 8 0 00-1.7 1l-2.6-1-2 3.5L6.2 11a7.7 7.7 0 000 2l-2.1 1.6 2 3.5 2.6-1a8 8 0 001.7 1l.4 2.8h4l.4-2.8a8 8 0 001.7-1l2.6 1 2-3.5-2.1-1.6ZM12.8 15.5a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2Z" />
              </svg>
            </button>
            {state.summoner && (
              <div title={`${state.summoner.gameName}#${state.summoner.tagLine}`}>
                <Avatar url={profileIcon(sd, state.summoner.profileIconId)} size={40} />
              </div>
            )}
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", zIndex: 1 }}>
          <header
            className="lobly-page-header"
            style={{
              minHeight: 82,
              flexShrink: 0,
              borderBottom: `1px solid ${c.border}`,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "12px 28px",
              background: "rgba(6,10,17,.74)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: c.primary,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: 1.7,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {activeMeta.eyebrow}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.35, fontWeight: 760 }}>
                  {activeMeta.label}
                </h1>
                <span className="lobly-truncate" style={{ color: c.textFaint, fontSize: 12 }}>
                  {activeMeta.description}
                </span>
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
              <PhasePill phase={state.gameflowPhase} />
              <Tag
                color={
                  state.listing.status === ListingStatus.LISTED ||
                  state.listing.status === ListingStatus.FILLING
                    ? c.win
                    : c.textDim
                }
              >
                {state.listing.status}
              </Tag>
            </div>
          </header>

          {(state.apiUnreachable || (state.authenticated && !state.sync.connected && syncDownMs > 5000)) && (
            <div
              style={{
                background: c.warn,
                color: "#1a1206",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
              }}
            >
              {state.apiUnreachable
                ? "Can't reach LOBLY servers — retrying"
                : "Reconnecting to LOBLY…"}
            </div>
          )}

          <PostGameBanner />
          <main
            className="lobly-page lobly-page-grid"
            style={{ flex: 1, overflowY: "auto", padding: 28, position: "relative" }}
          >
            <div className="lobly-fade" key={tab} style={{ maxWidth: 1240, margin: "0 auto" }}>
              {needsGate ? (
                <SignInGate state={state} />
              ) : (
                <>
                  {tab === "postgame" ? (
                    <PostGameView />
                  ) : (
                    <>
                      {tab === "board" && <BoardView />}
                      {tab === "listing" && <ListingView state={state} bridge={bridge} />}
                      {tab === "requests" && <RequestsView state={state} />}
                      {tab === "session" && <SessionView state={state} bridge={bridge} />}
                      {tab === "profile" && <ProfileView />}
                      {tab === "settings" && <SettingsView state={state} bridge={bridge} />}
                    </>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
      </div>

      <Toast message={state.toast?.message} at={state.toast?.at} />
    </div>
  );
}

/* --------------------------------------------------------- shell widgets */

function isTab(value: string | undefined): value is Tab {
  return (
    value === "board" ||
    value === "listing" ||
    value === "requests" ||
    value === "session" ||
    value === "profile" ||
    value === "settings" ||
    value === "postgame"
  );
}

function NavButton({
  label,
  icon,
  active,
  badge,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  badge: number;
  onClick: () => void;
}) {
  return (
    <button
      className="lobly-nav-button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
      style={{
        width: "100%",
        minHeight: 57,
        border: `1px solid ${active ? "rgba(66,215,255,.25)" : "transparent"}`,
        background: active
          ? "linear-gradient(135deg, rgba(66,215,255,.13), rgba(155,123,255,.07))"
          : "transparent",
        borderRadius: radius.lg,
        color: active ? c.primary : c.textFaint,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        position: "relative",
        transition: "background .16s ease, color .16s ease, border-color .16s ease",
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: -11,
            width: 3,
            height: 24,
            background: gradient.brand,
            borderRadius: "0 4px 4px 0",
            boxShadow: `0 0 14px ${c.primary}`,
          }}
        />
      )}
      <svg width={19} height={19} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d={icon} />
      </svg>
      <span style={{ fontSize: 9, fontWeight: 700, color: active ? c.text : "inherit" }}>
        {label}
      </span>
      {badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            display: "grid",
            placeItems: "center",
            color: "#071018",
            background: c.primary,
            borderRadius: radius.pill,
            fontFamily: font.mono,
            fontSize: 8,
            fontWeight: 900,
            boxShadow: `0 0 12px ${c.primary}88`,
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

function ConnectionBeacon({
  league,
  server,
  title,
}: {
  league: boolean;
  server: boolean;
  title: string;
}) {
  return (
    <div
      title={title}
      style={{
        display: "flex",
        justifyContent: "center",
        gap: 7,
        padding: "8px 0",
        borderRadius: radius.md,
        background: "rgba(255,255,255,.02)",
      }}
    >
      {[league, server].map((ok, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: ok ? c.win : c.textFaint,
            boxShadow: ok ? `0 0 8px ${c.win}` : undefined,
            animation: ok ? "lobly-pulse 2.8s ease-in-out infinite" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function DesktopTitleBar({ controls }: { controls: WindowControls }) {
  const [maximized, setMaximized] = useState(() => controls.isMaximized());

  useEffect(() => controls.onMaximizedChange(setMaximized), [controls]);

  return (
    <div
      className="lobly-drag"
      onDoubleClick={() => controls.toggleMaximize()}
      style={{
        height: 38,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        borderBottom: `1px solid ${c.border}`,
        background: c.bgDeep,
        paddingLeft: 12,
        userSelect: "none",
        zIndex: 10,
      }}
    >
      <BrandMark size={20} />
      <span
        style={{
          marginLeft: 8,
          color: c.textDim,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.4,
        }}
      >
        LOBLY
      </span>
      <span style={{ marginLeft: 8, color: c.textFaint, fontSize: 9 }}>LEAGUE COMPANION</span>
      <div
        className="lobly-no-drag"
        style={{ marginLeft: "auto", height: "100%", display: "flex", alignItems: "center" }}
      >
        <WindowButton title="Minimize" onClick={() => controls.minimize?.()}>
          <path d="M5 11h10v1H5z" />
        </WindowButton>
        <WindowButton
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => controls.toggleMaximize()}
        >
          {maximized ? (
            <path d="M6.5 4.5h9v9h-2v2h-9v-9h2v-2Zm1 2v7h5v-7h-5Zm-2 1v7h7v-1h-6v-6h-1Z" />
          ) : (
            <path d="M5.5 5.5h9v9h-9v-9Zm1 1v7h7v-7h-7Z" />
          )}
        </WindowButton>
        <WindowButton title="Close" danger onClick={() => controls.close?.()}>
          <path d="m6.2 5.5 3.8 3.8 3.8-3.8.7.7-3.8 3.8 3.8 3.8-.7.7-3.8-3.8-3.8 3.8-.7-.7L9.3 10 5.5 6.2l.7-.7Z" />
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <IconButton
      title={title}
      onClick={onClick}
      danger={danger}
      style={{ width: 44, height: "100%", borderRadius: 0 }}
    >
      <svg width={20} height={20} viewBox="0 0 20 20" fill="currentColor">
        {children}
      </svg>
    </IconButton>
  );
}

function PhasePill({ phase }: { phase: string }) {
  const live = phase !== "None";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: live ? c.text : c.textFaint,
        background: live ? c.surfaceAlt : "transparent",
        border: `1px solid ${live ? c.border : "transparent"}`,
        borderRadius: radius.pill,
        padding: "3px 10px",
        fontFamily: font.mono,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: live ? c.accent : c.textFaint,
        }}
      />
      {phase}
    </span>
  );
}

function Toast({ message, at }: { message?: string; at?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      getBridge()?.store.clearToast();
    }, 6000);
    return () => clearTimeout(t);
  }, [message, at]);

  if (!message || !visible) return null;
  return (
    <div
      className="lobly-fade"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        background: c.raised,
        border: `1px solid ${c.borderStrong}`,
        borderLeft: `3px solid ${c.primary}`,
        borderRadius: radius.md,
        padding: "12px 16px",
        maxWidth: 340,
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        zIndex: 100,
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
