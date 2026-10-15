import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ListingStatus } from "@lobly/shared-types";
import { useAppStore } from "../shared/messaging";
import { getBridge } from "../shared/bridge";
import { c, gradient, radius, GLOBAL_CSS, font } from "./theme";
import { Avatar, BrandMark, IconButton, Tag } from "./components";
import { ProfileView } from "./ProfileView";
import { BoardView } from "./BoardView";
import { ListingView, RequestsView, SessionView } from "./LobbyViews";
import { SettingsView } from "./SettingsView";
import { SignInGate } from "./SignInGate";
import { PostGameBanner, PostGameView } from "./PostGameView";
import { profileIcon, useStaticData } from "./useStaticData";
const NAV = [
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
    const tab = (isTab(state.uiTab) ? state.uiTab : "profile");
    const setTab = (next) => {
        if (bridge?.navigate)
            bridge.navigate(next);
        else
            bridge?.store.update({ uiTab: next });
    };
    const pending = (state.pendingRequests?.length ?? 0) + (state.outgoingRequests?.length ?? 0);
    const [syncDownMs, setSyncDownMs] = useState(0);
    const windowControls = bridge?.windowControls;
    const activeMeta = tab === "postgame"
        ? {
            label: "Post-game",
            eyebrow: "Match Recap",
            description: "Review the game you just played and endorse your teammates.",
        }
        : (NAV.find((n) => n.id === tab) ??
            {
                label: "Settings",
                eyebrow: "Preferences",
                description: "Matchmaking, accounts, privacy and diagnostics.",
            });
    useEffect(() => {
        return bridge?.onNavigate?.((next) => {
            if (isTab(next))
                bridge.store.update({ uiTab: next });
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
    const needsGate = state.authChecked &&
        (state.authExpired || state.accountMismatch || (!state.authenticated && !state.hasStoredSession));
    // One global stylesheet for the whole app (resets, scrollbars, keyframes).
    useEffect(() => {
        const id = "lobly-global-css";
        if (document.getElementById(id))
            return;
        const el = document.createElement("style");
        el.id = id;
        el.textContent = GLOBAL_CSS;
        document.head.appendChild(el);
    }, []);
    return (_jsxs("div", { style: {
            height: "100%",
            background: c.bg,
            color: c.text,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
        }, children: [windowControls && _jsx(DesktopTitleBar, { controls: windowControls }), _jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", position: "relative" }, children: [_jsx("div", { "aria-hidden": true, style: {
                            position: "absolute",
                            width: 520,
                            height: 520,
                            borderRadius: "50%",
                            right: -240,
                            top: -250,
                            background: "rgba(64,111,255,.08)",
                            filter: "blur(80px)",
                            pointerEvents: "none",
                        } }), _jsxs("aside", { style: {
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
                        }, children: [_jsx(BrandMark, { size: 42 }), _jsx("div", { style: {
                                    width: 24,
                                    height: 1,
                                    margin: "18px 0 14px",
                                    background: `linear-gradient(90deg, transparent, ${c.borderStrong}, transparent)`,
                                } }), _jsx("nav", { "aria-label": "Primary navigation", style: { width: "100%", display: "flex", flexDirection: "column", gap: 7 }, children: NAV.map((n) => (_jsx(NavButton, { label: n.label, icon: n.icon, active: tab === n.id, badge: n.id === "requests" ? pending : 0, onClick: () => setTab(n.id) }, n.id))) }), _jsxs("div", { style: { marginTop: "auto", width: "100%", display: "grid", gap: 10 }, children: [_jsx(ConnectionBeacon, { league: state.lcu.connected, server: state.sync.connected, title: `League ${state.lcu.connected ? "connected" : "offline"} · LOBLY ${state.sync.connected ? "online" : "offline"}` }), _jsx("button", { className: "lobly-nav-button", onClick: () => setTab("settings"), title: "Settings", style: {
                                            width: "100%",
                                            minHeight: 48,
                                            border: "1px solid transparent",
                                            background: tab === "settings" ? c.primarySoft : "transparent",
                                            borderRadius: radius.lg,
                                            color: tab === "settings" ? c.primary : c.textFaint,
                                            display: "grid",
                                            placeItems: "center",
                                        }, children: _jsx("svg", { width: 19, height: 19, viewBox: "0 0 24 24", fill: "currentColor", children: _jsx("path", { d: "M19.4 13a7.7 7.7 0 000-2l2.1-1.6-2-3.5-2.6 1a8 8 0 00-1.7-1L14.8 3h-4l-.4 2.8a8 8 0 00-1.7 1l-2.6-1-2 3.5L6.2 11a7.7 7.7 0 000 2l-2.1 1.6 2 3.5 2.6-1a8 8 0 001.7 1l.4 2.8h4l.4-2.8a8 8 0 001.7-1l2.6 1 2-3.5-2.1-1.6ZM12.8 15.5a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2Z" }) }) }), state.summoner && (_jsx("div", { title: `${state.summoner.gameName}#${state.summoner.tagLine}`, children: _jsx(Avatar, { url: profileIcon(sd, state.summoner.profileIconId), size: 40 }) }))] })] }), _jsxs("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", zIndex: 1 }, children: [_jsxs("header", { className: "lobly-page-header", style: {
                                    minHeight: 82,
                                    flexShrink: 0,
                                    borderBottom: `1px solid ${c.border}`,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 18,
                                    padding: "12px 28px",
                                    background: "rgba(6,10,17,.74)",
                                    backdropFilter: "blur(20px)",
                                }, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                                    color: c.primary,
                                                    fontSize: 9,
                                                    fontWeight: 800,
                                                    letterSpacing: 1.7,
                                                    textTransform: "uppercase",
                                                    marginBottom: 4,
                                                }, children: activeMeta.eyebrow }), _jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 12 }, children: [_jsx("h1", { style: { margin: 0, fontSize: 22, letterSpacing: -0.35, fontWeight: 760 }, children: activeMeta.label }), _jsx("span", { className: "lobly-truncate", style: { color: c.textFaint, fontSize: 12 }, children: activeMeta.description })] })] }), _jsxs("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }, children: [_jsx(PhasePill, { phase: state.gameflowPhase }), _jsx(Tag, { color: state.listing.status === ListingStatus.LISTED ||
                                                    state.listing.status === ListingStatus.FILLING
                                                    ? c.win
                                                    : c.textDim, children: state.listing.status })] })] }), (state.apiUnreachable || (state.authenticated && !state.sync.connected && syncDownMs > 5000)) && (_jsx("div", { style: {
                                    background: c.warn,
                                    color: "#1a1206",
                                    textAlign: "center",
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: "6px 12px",
                                }, children: state.apiUnreachable
                                    ? "Can't reach LOBLY servers — retrying"
                                    : "Reconnecting to LOBLY…" })), _jsx(PostGameBanner, {}), _jsx("main", { className: "lobly-page lobly-page-grid", style: { flex: 1, overflowY: "auto", padding: 28, position: "relative" }, children: _jsx("div", { className: "lobly-fade", style: { maxWidth: 1240, margin: "0 auto" }, children: needsGate ? (_jsx(SignInGate, { state: state })) : (_jsx(_Fragment, { children: tab === "postgame" ? (_jsx(PostGameView, {})) : (_jsxs(_Fragment, { children: [tab === "board" && _jsx(BoardView, {}), tab === "listing" && _jsx(ListingView, { state: state, bridge: bridge }), tab === "requests" && _jsx(RequestsView, { state: state }), tab === "session" && _jsx(SessionView, { state: state, bridge: bridge }), tab === "profile" && _jsx(ProfileView, {}), tab === "settings" && _jsx(SettingsView, { state: state, bridge: bridge })] })) })) }, tab) })] })] }), _jsx(Toast, { message: state.toast?.message, at: state.toast?.at })] }));
}
/* --------------------------------------------------------- shell widgets */
function isTab(value) {
    return (value === "board" ||
        value === "listing" ||
        value === "requests" ||
        value === "session" ||
        value === "profile" ||
        value === "settings" ||
        value === "postgame");
}
function NavButton({ label, icon, active, badge, onClick, }) {
    return (_jsxs("button", { className: "lobly-nav-button", onClick: onClick, "aria-current": active ? "page" : undefined, title: label, style: {
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
        }, children: [active && (_jsx("span", { style: {
                    position: "absolute",
                    left: -11,
                    width: 3,
                    height: 24,
                    background: gradient.brand,
                    borderRadius: "0 4px 4px 0",
                    boxShadow: `0 0 14px ${c.primary}`,
                } })), _jsx("svg", { width: 19, height: 19, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, children: _jsx("path", { d: icon }) }), _jsx("span", { style: { fontSize: 9, fontWeight: 700, color: active ? c.text : "inherit" }, children: label }), badge > 0 && (_jsx("span", { style: {
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
                }, children: badge > 9 ? "9+" : badge }))] }));
}
function ConnectionBeacon({ league, server, title, }) {
    return (_jsx("div", { title: title, style: {
            display: "flex",
            justifyContent: "center",
            gap: 7,
            padding: "8px 0",
            borderRadius: radius.md,
            background: "rgba(255,255,255,.02)",
        }, children: [league, server].map((ok, i) => (_jsx("span", { style: {
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: ok ? c.win : c.textFaint,
                boxShadow: ok ? `0 0 8px ${c.win}` : undefined,
                animation: ok ? "lobly-pulse 2.8s ease-in-out infinite" : undefined,
            } }, i))) }));
}
function DesktopTitleBar({ controls }) {
    const [maximized, setMaximized] = useState(() => controls.isMaximized());
    useEffect(() => controls.onMaximizedChange(setMaximized), [controls]);
    return (_jsxs("div", { className: "lobly-drag", onDoubleClick: () => controls.toggleMaximize(), style: {
            height: 38,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            borderBottom: `1px solid ${c.border}`,
            background: c.bgDeep,
            paddingLeft: 12,
            userSelect: "none",
            zIndex: 10,
        }, children: [_jsx(BrandMark, { size: 20 }), _jsx("span", { style: {
                    marginLeft: 8,
                    color: c.textDim,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 1.4,
                }, children: "LOBLY" }), _jsx("span", { style: { marginLeft: 8, color: c.textFaint, fontSize: 9 }, children: "LEAGUE COMPANION" }), _jsxs("div", { className: "lobly-no-drag", style: { marginLeft: "auto", height: "100%", display: "flex", alignItems: "center" }, children: [_jsx(WindowButton, { title: "Minimize", onClick: () => controls.minimize?.(), children: _jsx("path", { d: "M5 11h10v1H5z" }) }), _jsx(WindowButton, { title: maximized ? "Restore" : "Maximize", onClick: () => controls.toggleMaximize(), children: maximized ? (_jsx("path", { d: "M6.5 4.5h9v9h-2v2h-9v-9h2v-2Zm1 2v7h5v-7h-5Zm-2 1v7h7v-1h-6v-6h-1Z" })) : (_jsx("path", { d: "M5.5 5.5h9v9h-9v-9Zm1 1v7h7v-7h-7Z" })) }), _jsx(WindowButton, { title: "Close", danger: true, onClick: () => controls.close?.(), children: _jsx("path", { d: "m6.2 5.5 3.8 3.8 3.8-3.8.7.7-3.8 3.8 3.8 3.8-.7.7-3.8-3.8-3.8 3.8-.7-.7L9.3 10 5.5 6.2l.7-.7Z" }) })] })] }));
}
function WindowButton({ title, onClick, danger, children, }) {
    return (_jsx(IconButton, { title: title, onClick: onClick, danger: danger, style: { width: 44, height: "100%", borderRadius: 0 }, children: _jsx("svg", { width: 20, height: 20, viewBox: "0 0 20 20", fill: "currentColor", children: children }) }));
}
function PhasePill({ phase }) {
    const live = phase !== "None";
    return (_jsxs("span", { style: {
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
        }, children: [_jsx("span", { style: {
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: live ? c.accent : c.textFaint,
                } }), phase] }));
}
function Toast({ message, at }) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (!message)
            return;
        setVisible(true);
        const t = setTimeout(() => {
            setVisible(false);
            getBridge()?.store.clearToast();
        }, 6000);
        return () => clearTimeout(t);
    }, [message, at]);
    if (!message || !visible)
        return null;
    return (_jsx("div", { className: "lobly-fade", style: {
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
        }, children: message }));
}
