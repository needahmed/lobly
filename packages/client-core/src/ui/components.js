import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { c, gradient, radius, font, shadow, tierColor, ROLE_ICON, ROLE_LABEL } from "./theme";
/* --------------------------------------------------------------- Brand */
export function BrandMark({ size = 34 }) {
    return (_jsx("div", { "aria-label": "LOBLY", style: {
            width: size,
            height: size,
            position: "relative",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            filter: "drop-shadow(0 0 12px rgba(66,215,255,.24))",
        }, children: _jsxs("svg", { width: size, height: size, viewBox: "0 0 40 40", fill: "none", "aria-hidden": true, children: [_jsx("path", { d: "M20 2.7 35.4 11.6v16.8L20 37.3 4.6 28.4V11.6L20 2.7Z", fill: "url(#lobly-mark-bg)", stroke: "rgba(125,224,255,.62)" }), _jsx("path", { d: "m12.3 10.8 4.1 2.4v11.5l9.7-5.6v5.2l-9.7 5.6-4.1-2.4V10.8Zm12.1 1.7 4.1 2.4v4.7l-4.1 2.4v-9.5Z", fill: "url(#lobly-mark-fg)" }), _jsxs("defs", { children: [_jsxs("linearGradient", { id: "lobly-mark-bg", x1: "7", y1: "6", x2: "33", y2: "35", children: [_jsx("stop", { stopColor: "#172a40" }), _jsx("stop", { offset: "1", stopColor: "#080d16" })] }), _jsxs("linearGradient", { id: "lobly-mark-fg", x1: "11", y1: "10", x2: "29", y2: "29", children: [_jsx("stop", { stopColor: "#A6EFFF" }), _jsx("stop", { offset: ".48", stopColor: "#42D7FF" }), _jsx("stop", { offset: "1", stopColor: "#A987FF" })] })] })] }) }));
}
/* ------------------------------------------------------------------ Card */
export function Card({ children, style, pad = 16, interactive = false, }) {
    return (_jsx("div", { className: interactive ? "lobly-lift" : undefined, style: {
            background: gradient.surface,
            border: `1px solid ${c.border}`,
            borderRadius: radius.xl,
            padding: pad,
            boxShadow: shadow.sm,
            backdropFilter: "blur(16px)",
            ...style,
        }, children: children }));
}
export function SectionTitle({ children, right, }) {
    return (_jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
        }, children: [_jsx("h2", { style: {
                    margin: 0,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 1.25,
                    textTransform: "uppercase",
                    color: c.textDim,
                }, children: children }), right] }));
}
export function Button({ children, onClick, variant = "ghost", size = "md", disabled, style, title, }) {
    const palette = {
        primary: {
            background: gradient.brand,
            color: "#061018",
            border: "1px solid rgba(129,229,255,.72)",
            boxShadow: "0 8px 24px rgba(66,215,255,.16)",
        },
        ghost: {
            background: "rgba(255,255,255,.035)",
            color: c.text,
            border: `1px solid ${c.border}`,
        },
        subtle: { background: "transparent", color: c.textDim, border: "1px solid transparent" },
        danger: { background: c.lossSoft, color: c.loss, border: `1px solid ${c.loss}44` },
    };
    return (_jsx("button", { onClick: onClick, disabled: disabled, title: title, style: {
            ...palette[variant],
            padding: size === "sm" ? "6px 11px" : "9px 16px",
            borderRadius: radius.md,
            fontSize: size === "sm" ? 12 : 13,
            fontWeight: 750,
            letterSpacing: 0.1,
            transition: "filter 120ms ease, transform 120ms ease, border-color 120ms ease",
            ...style,
        }, onMouseEnter: (e) => {
            e.currentTarget.style.filter = "brightness(1.12)";
            e.currentTarget.style.transform = "translateY(-1px)";
        }, onMouseLeave: (e) => {
            e.currentTarget.style.filter = "none";
            e.currentTarget.style.transform = "none";
        }, children: children }));
}
export function IconButton({ children, onClick, title, danger, style, }) {
    return (_jsx("button", { className: "lobly-icon-button", type: "button", onClick: onClick, title: title, "aria-label": title, style: {
            width: 34,
            height: 34,
            border: "1px solid transparent",
            borderRadius: radius.md,
            display: "grid",
            placeItems: "center",
            color: danger ? c.loss : c.textDim,
            background: "transparent",
            transition: "background .14s ease, color .14s ease",
            ...style,
        }, children: children }));
}
/* ------------------------------------------------------------------- Tag */
export function Tag({ children, color = c.textDim, bg, title, }) {
    return (_jsx("span", { title: title, style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: bg ?? `${color}1f`,
            color,
            border: `1px solid ${color}22`,
            borderRadius: radius.pill,
            padding: "3px 8px",
            fontSize: 10,
            fontWeight: 750,
            letterSpacing: 0.25,
            lineHeight: 1.5,
            whiteSpace: "nowrap",
        }, children: children }));
}
/* ------------------------------------------------------------- Role icon */
export function RoleIcon({ role, size = 14, color = c.textDim, }) {
    const path = role ? ROLE_ICON[role] : undefined;
    if (!path)
        return null;
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: color, "aria-hidden": true, children: _jsx("path", { d: path }) }));
}
/** Filled roles solid, open roles faded. Non-positional queues show "3/5". */
export function PartyStrip({ positional, count, max, filled, open, }) {
    if (!positional) {
        return (_jsxs("span", { style: { color: c.text, fontSize: 12, fontWeight: 700 }, children: [count, "/", max] }));
    }
    const openOnly = open.filter((role) => role && !filled.includes(role));
    if (!filled.length && !openOnly.length)
        return null;
    return (_jsxs("span", { style: { display: "inline-flex", gap: 4, alignItems: "center" }, children: [filled.map((role) => (_jsx(RoleIcon, { role: role, size: 14, color: c.text }, `filled-${role}`))), openOnly.map((role) => (_jsx("span", { title: `${role} open`, style: { opacity: 0.4 }, children: _jsx(RoleIcon, { role: role, size: 14 }) }, `open-${role}`)))] }));
}
export function RoleLabel({ role }) {
    if (!role)
        return _jsx("span", { style: { color: c.textFaint }, children: "\u2014" });
    return (_jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 5 }, children: [_jsx(RoleIcon, { role: role }), ROLE_LABEL[role] ?? role] }));
}
/* ------------------------------------------------------------ Rank badge */
export function RankBadge({ tier, division, lp, size = "md", }) {
    const col = tierColor(tier);
    const label = tier
        ? `${titleCase(tier)}${division ? ` ${division}` : ""}`
        : "Unranked";
    const fs = size === "lg" ? 15 : size === "md" ? 13 : 12;
    return (_jsxs("span", { style: { display: "inline-flex", alignItems: "baseline", gap: 6 }, children: [_jsx("span", { style: { color: col, fontWeight: 700, fontSize: fs }, children: label }), lp != null && tier && (_jsxs("span", { style: { color: c.textDim, fontSize: fs - 2 }, children: [lp, " LP"] }))] }));
}
export function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
/* ---------------------------------------------------------------- States */
export function Spinner({ size = 18 }) {
    return (_jsx("div", { style: {
            width: size,
            height: size,
            border: `2px solid rgba(255,255,255,.08)`,
            borderTopColor: c.primary,
            boxShadow: `0 0 14px ${c.primarySoft}`,
            borderRadius: "50%",
            animation: "lobly-spin 0.7s linear infinite",
        } }));
}
export function EmptyState({ icon, title, hint, action, }) {
    return (_jsxs("div", { style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "48px 24px",
            textAlign: "center",
            color: c.textFaint,
        }, children: [icon && _jsx("div", { style: { fontSize: 28, opacity: 0.6 }, children: icon }), _jsx("div", { style: { color: c.textDim, fontWeight: 600, fontSize: 14 }, children: title }), hint && _jsx("div", { style: { maxWidth: 380, lineHeight: 1.6 }, children: hint }), action && _jsx("div", { style: { marginTop: 8 }, children: action })] }));
}
export function LoadingBlock({ label = "Loading" }) {
    return (_jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            minHeight: 160,
            padding: 40,
            color: c.textDim,
        }, children: [_jsx(Spinner, {}), label, "\u2026"] }));
}
/* ----------------------------------------------------------------- Stats */
export function StatBlock({ label, value, sub, color, align = "left", }) {
    return (_jsxs("div", { style: { textAlign: align }, children: [_jsx("div", { style: {
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: c.textFaint,
                    fontWeight: 600,
                }, children: label }), _jsx("div", { style: {
                    fontSize: 19,
                    fontWeight: 780,
                    color: color ?? c.text,
                    fontFamily: font.mono,
                    marginTop: 2,
                }, children: value }), sub && _jsx("div", { style: { fontSize: 11, color: c.textDim, marginTop: 1 }, children: sub })] }));
}
/** Horizontal win/loss meter. */
export function WinRateBar({ wins, losses, height = 6, }) {
    const total = wins + losses;
    const pct = total > 0 ? (wins / total) * 100 : 0;
    return (_jsx("div", { style: {
            height,
            background: c.lossSoft,
            borderRadius: radius.pill,
            overflow: "hidden",
        }, children: _jsx("div", { style: {
                width: `${pct}%`,
                height: "100%",
                background: c.win,
                borderRadius: radius.pill,
            } }) }));
}
export function Avatar({ url, size = 40, ring, alt = "", }) {
    return (_jsx("div", { style: {
            width: size,
            height: size,
            borderRadius: size > 50 ? radius.xl : radius.md,
            background: c.surfaceAlt,
            border: ring ? `2px solid ${ring}` : `1px solid ${c.border}`,
            boxShadow: ring ? `0 0 24px ${ring}22` : undefined,
            overflow: "hidden",
            flexShrink: 0,
        }, children: url && (_jsx("img", { src: url, alt: alt, width: size, height: size, style: { display: "block", width: "100%", height: "100%", objectFit: "cover" } })) }));
}
export { c, gradient, radius, font, shadow, tierColor };
