import type { CSSProperties, ReactNode } from "react";
import { c, gradient, radius, font, shadow, tierColor, ROLE_ICON, ROLE_LABEL } from "./theme";

/* --------------------------------------------------------------- Brand */

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <div
      aria-label="LOBLY"
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        filter: "drop-shadow(0 0 12px rgba(66,215,255,.24))",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
        <path
          d="M20 2.7 35.4 11.6v16.8L20 37.3 4.6 28.4V11.6L20 2.7Z"
          fill="url(#lobly-mark-bg)"
          stroke="rgba(125,224,255,.62)"
        />
        <path
          d="m12.3 10.8 4.1 2.4v11.5l9.7-5.6v5.2l-9.7 5.6-4.1-2.4V10.8Zm12.1 1.7 4.1 2.4v4.7l-4.1 2.4v-9.5Z"
          fill="url(#lobly-mark-fg)"
        />
        <defs>
          <linearGradient id="lobly-mark-bg" x1="7" y1="6" x2="33" y2="35">
            <stop stopColor="#172a40" />
            <stop offset="1" stopColor="#080d16" />
          </linearGradient>
          <linearGradient id="lobly-mark-fg" x1="11" y1="10" x2="29" y2="29">
            <stop stopColor="#A6EFFF" />
            <stop offset=".48" stopColor="#42D7FF" />
            <stop offset="1" stopColor="#A987FF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  style,
  pad = 16,
  interactive = false,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
  interactive?: boolean;
}) {
  return (
    <div
      className={interactive ? "lobly-lift" : undefined}
      style={{
        background: gradient.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.xl,
        padding: pad,
        boxShadow: shadow.sm,
        backdropFilter: "blur(16px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.25,
          textTransform: "uppercase",
          color: c.textDim,
        }}
      >
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ---------------------------------------------------------------- Button */

type BtnVariant = "primary" | "ghost" | "danger" | "subtle";

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
}) {
  const palette: Record<BtnVariant, CSSProperties> = {
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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...palette[variant],
        padding: size === "sm" ? "6px 11px" : "9px 16px",
        borderRadius: radius.md,
        fontSize: size === "sm" ? 12 : 13,
        fontWeight: 750,
        letterSpacing: 0.1,
        transition: "filter 120ms ease, transform 120ms ease, border-color 120ms ease",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = "brightness(1.12)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "none";
        e.currentTarget.style.transform = "none";
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  title,
  danger,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  title: string;
  danger?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      className="lobly-icon-button"
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
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
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Tag */

export function Tag({
  children,
  color = c.textDim,
  bg,
  title,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
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
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Role icon */

export function RoleIcon({
  role,
  size = 14,
  color = c.textDim,
}: {
  role?: string | null;
  size?: number;
  color?: string;
}) {
  const path = role ? ROLE_ICON[role] : undefined;
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d={path} />
    </svg>
  );
}

export function RoleLabel({ role }: { role?: string | null }) {
  if (!role) return <span style={{ color: c.textFaint }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <RoleIcon role={role} />
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/* ------------------------------------------------------------ Rank badge */

export function RankBadge({
  tier,
  division,
  lp,
  size = "md",
}: {
  tier?: string | null;
  division?: string | null;
  lp?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const col = tierColor(tier);
  const label = tier
    ? `${titleCase(tier)}${division ? ` ${division}` : ""}`
    : "Unranked";
  const fs = size === "lg" ? 15 : size === "md" ? 13 : 12;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ color: col, fontWeight: 700, fontSize: fs }}>{label}</span>
      {lp != null && tier && (
        <span style={{ color: c.textDim, fontSize: fs - 2 }}>{lp} LP</span>
      )}
    </span>
  );
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/* ---------------------------------------------------------------- States */

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `2px solid rgba(255,255,255,.08)`,
        borderTopColor: c.primary,
        boxShadow: `0 0 14px ${c.primarySoft}`,
        borderRadius: "50%",
        animation: "lobly-spin 0.7s linear infinite",
      }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "48px 24px",
        textAlign: "center",
        color: c.textFaint,
      }}
    >
      {icon && <div style={{ fontSize: 28, opacity: 0.6 }}>{icon}</div>}
      <div style={{ color: c.textDim, fontWeight: 600, fontSize: 14 }}>{title}</div>
      {hint && <div style={{ maxWidth: 380, lineHeight: 1.6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        minHeight: 160,
        padding: 40,
        color: c.textDim,
      }}
    >
      <Spinner />
      {label}…
    </div>
  );
}

/* ----------------------------------------------------------------- Stats */

export function StatBlock({
  label,
  value,
  sub,
  color,
  align = "left",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  align?: "left" | "center";
}) {
  return (
    <div style={{ textAlign: align }}>
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: c.textFaint,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 19,
          fontWeight: 780,
          color: color ?? c.text,
          fontFamily: font.mono,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: c.textDim, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/** Horizontal win/loss meter. */
export function WinRateBar({
  wins,
  losses,
  height = 6,
}: {
  wins: number;
  losses: number;
  height?: number;
}) {
  const total = wins + losses;
  const pct = total > 0 ? (wins / total) * 100 : 0;
  return (
    <div
      style={{
        height,
        background: c.lossSoft,
        borderRadius: radius.pill,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: c.win,
          borderRadius: radius.pill,
        }}
      />
    </div>
  );
}

export function Avatar({
  url,
  size = 40,
  ring,
  alt = "",
}: {
  url?: string | null;
  size?: number;
  ring?: string;
  alt?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size > 50 ? radius.xl : radius.md,
        background: c.surfaceAlt,
        border: ring ? `2px solid ${ring}` : `1px solid ${c.border}`,
        boxShadow: ring ? `0 0 24px ${ring}22` : undefined,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {url && (
        <img
          src={url}
          alt={alt}
          width={size}
          height={size}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </div>
  );
}

export { c, gradient, radius, font, shadow, tierColor };
