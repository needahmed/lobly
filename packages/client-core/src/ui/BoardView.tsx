import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ALL_ROLES,
  TIER_ORDER,
  eligibilityReasonText,
  formatSlotRoles,
  queueName,
  slotAcceptsRole,
  type BoardRow,
  type BoardSort,
  type Role,
} from "@lobly/shared-types";
import { cancelJoin, fetchBoard, requestJoin, type BoardQuery } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import { c, radius, font } from "./theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  RankBadge,
  PartyStrip,
  RoleIcon,
  Tag,
} from "./components";
import { profileIcon, useStaticData } from "./useStaticData";
import { PlayerMenu } from "./PlayerMenu";

const HIDE_KEY = "lobly.board.hideIneligible";

export function BoardView() {
  const sd = useStaticData();
  const app = useAppStore();
  const [rolePick, setRolePick] = useState<Record<string, Role>>({});
  const bridge = getBridge();
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hideIneligible, setHideIneligible] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [queueId, setQueueId] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [minRank, setMinRank] = useState("");
  const [sort, setSort] = useState<BoardSort>("score");
  const [revision, setRevision] = useState(0);

  const load = () => {
    setRows(null);
    setError(null);
    const q: BoardQuery = { sort };
    if (queueId) q.queueId = Number(queueId);
    if (role) q.roles = role;
    if (minRank) q.minRank = minRank;
    void fetchBoard(q)
      .then(setRows)
      .catch((e) => setError(e?.body?.message ?? e?.message ?? "Failed to load board"));
  };

  useEffect(load, [queueId, role, minRank, sort]);

  // Live board.delta → refetch
  useEffect(() => {
    const store = bridge?.store;
    if (!store) return;
    return store.subscribe(() => {
      const rev = store.state.boardRevision ?? 0;
      if (rev !== revision) {
        setRevision(rev);
        load();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, revision]);

  const visible = useMemo(() => {
    if (!rows) return null;
    if (!hideIneligible) return rows;
    return rows.filter((r) => r.isOwn || r.eligible);
  }, [rows, hideIneligible]);

  const toggleHide = () => {
    const next = !hideIneligible;
    setHideIneligible(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        pad={20}
        style={{
          overflow: "hidden",
          position: "relative",
          background:
            "radial-gradient(circle at 85% 0%, rgba(155,123,255,.15), transparent 36%), linear-gradient(135deg, rgba(16,31,50,.98), rgba(7,13,23,.98))",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -28,
            bottom: -58,
            width: 220,
            height: 150,
            border: `1px solid ${c.borderStrong}`,
            transform: "rotate(-18deg)",
            opacity: 0.18,
          }}
        />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18, position: "relative" }}>
          <div>
            <div
              style={{
                color: c.primary,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              Live team network
            </div>
            <div style={{ fontSize: 22, fontWeight: 760, marginTop: 5 }}>
              Find your next win condition.
            </div>
            <div style={{ color: c.textDim, maxWidth: 560, marginTop: 5, lineHeight: 1.55 }}>
              Every lobby is verified against a live League account. Filter by the role and
              competitive fit that matters to you.
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontFamily: font.mono, fontSize: 28, fontWeight: 800 }}>
              {visible?.length ?? "—"}
            </div>
            <div style={{ color: c.textFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>
              open now
            </div>
          </div>
        </div>
      </Card>

      <Card pad={13} style={{ background: "rgba(9,15,25,.82)" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <select
            value={queueId}
            onChange={(e) => setQueueId(e.target.value)}
            style={filterStyle}
          >
            <option value="">All queues</option>
            <option value="420">Solo/Duo</option>
            <option value="440">Flex</option>
            <option value="450">ARAM</option>
            <option value="490">Quickplay</option>
            <option value="700">Clash</option>
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={filterStyle}>
            <option value="">Any role</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={minRank}
            onChange={(e) => setMinRank(e.target.value)}
            style={filterStyle}
          >
            <option value="">Creator rank ≥</option>
            {TIER_ORDER.map((t) => (
              <option key={t} value={t}>
                {t}+
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as BoardSort)}
            style={filterStyle}
          >
            <option value="score">Best match</option>
            <option value="newest">Newest</option>
            <option value="rank">Highest rank</option>
          </select>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: c.textDim,
              marginLeft: 4,
            }}
          >
            <input type="checkbox" checked={hideIneligible} onChange={toggleHide} />
            Hide ones I can't join
          </label>
          <Button size="sm" onClick={load} style={{ marginLeft: "auto" }}>
            ↻ Refresh
          </Button>
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
        <span style={{ color: c.textDim, fontSize: 13 }}>
          {visible
            ? `${visible.length} open ${visible.length === 1 ? "lobby" : "lobbies"}`
            : " "}
        </span>
      </div>

      {rows === null && !error && (
        <Card>
          <LoadingBlock label="Finding lobbies" />
        </Card>
      )}

      {error && (
        <Card>
          <EmptyState
            title="Board unavailable"
            hint={error}
            action={<Button onClick={load}>Try again</Button>}
          />
        </Card>
      )}

      {visible?.length === 0 && (
        <Card>
          <EmptyState
            title="No lobbies right now"
            hint="Nobody on your server has an open listing. Create your own from My Lobby and let others find you."
          />
        </Card>
      )}

      {visible?.map((row) => {
        const open = row.listing.slots.find((s) => s.open);
        const openLabel = open
          ? formatSlotRoles(open.roles)
          : "Join";
        const dimmed = !row.isOwn && !row.eligible;
        const expiresIn = expiryLabel(row.listing.expiresAt);

        return (
          <Card
            key={row.listing.id}
            pad={17}
            interactive
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              opacity: dimmed ? 0.55 : 1,
              borderColor: row.isOwn ? `${c.primary}66` : undefined,
              background: row.isOwn
                ? "linear-gradient(115deg, rgba(66,215,255,.09), rgba(9,15,25,.96) 42%)"
                : undefined,
            }}
          >
            <Avatar url={profileIcon(sd, null)} size={50} ring={row.isOwn ? c.primary : undefined} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 760, fontSize: 15 }}>{row.listing.title}</span>
                <Tag color={c.textDim}>{queueName(row.listing.queueId)}</Tag>
                {row.isOwn && <Tag color={c.primary}>Your lobby</Tag>}
                {row.offRole && !row.isOwn && <Tag color={c.warn}>Off-role</Tag>}
                {row.provisional && <Tag color={c.warn}>Provisional</Tag>}
                {expiresIn && <Tag color={c.textFaint}>{expiresIn}</Tag>}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 6,
                  fontSize: 12,
                  color: c.textDim,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: c.text, fontWeight: 600 }}>
                  {row.creator.riotId}
                  <span style={{ color: c.textFaint }}>#{row.creator.tagLine}</span>
                </span>
                <RankBadge tier={row.creator.tier} division={row.creator.division} size="sm" />
                {row.creator.primaryRole && (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <RoleIcon role={row.creator.primaryRole} size={13} />
                    {row.creator.primaryRole}
                  </span>
                )}
                <span>{row.listing.slots.filter((s) => s.open).length} open</span>
                {row.listing.party?.members && (
                  <PartyStrip
                    positional={Boolean(row.listing.queueMeta?.positional)}
                    count={row.listing.party.members.length}
                    max={row.listing.queueMeta?.maxLobbySize ?? 5}
                    filled={row.listing.party.members
                      .map((m) => m.roles[0])
                      .filter((role): role is Role => role != null)}
                    open={row.listing.slots.filter((s) => s.open).flatMap((s) => s.roles)}
                  />
                )}
                <span>
                  {row.reliability != null ? `${row.reliability} rel` : "New player"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                {row.listing.slots
                  .filter((s) => s.open)
                  .map((s, i) => (
                    <Tag key={i} color={c.accent}>
                      {formatSlotRoles(s.roles)}
                    </Tag>
                  ))}
              </div>
              {dimmed && row.reasons?.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: c.warn }}>
                  {row.reasons.map(eligibilityReasonText).join(" · ")}
                </div>
              )}
            </div>

            {!row.isOwn && <MatchScore score={row.matchScore} />}

            {row.isOwn ? (
              <Button
                onClick={() => {
                  const b = getBridge();
                  if (b?.navigate) b.navigate("listing");
                  else b?.store.update({ uiTab: "listing" });
                }}
              >
                Edit / Unpublish
              </Button>
            ) : row.myRequest &&
              (row.myRequest.status === "PENDING" || row.myRequest.status === "ACCEPTED") ? (
              <Button
                disabled={busy === row.listing.id}
                onClick={async () => {
                  setBusy(row.listing.id);
                  try {
                    await cancelJoin(row.myRequest!.id);
                    getBridge()?.setToast("Request cancelled");
                  } catch (e: any) {
                    getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Couldn't cancel");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Requested · Cancel
              </Button>
            ) : (
              <JoinButton
                row={row}
                busy={busy === row.listing.id}
                choices={joinRoleChoices(row, app.profileHints?.primaryRole, app.profileHints?.secondaryRole)}
                picked={rolePick[row.listing.id]}
                onPick={(role) => setRolePick((cur) => ({ ...cur, [row.listing.id]: role }))}
                openLabel={openLabel}
                onJoin={async (joinRole) => {
                  setBusy(row.listing.id);
                  try {
                    const r = await requestJoin(row.listing.id, joinRole);
                    getBridge()?.setToast(`Request sent · match score ${r.matchScore}`);
                  } catch (e: any) {
                    const reasons = e?.body?.reasons;
                    getBridge()?.setToast(
                      Array.isArray(reasons) && reasons.length
                        ? `Can't join: ${reasons.map(eligibilityReasonText).join(", ")}`
                        : (e?.body?.message ?? e?.message ?? "Join failed")
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            )}
            {!row.isOwn && (
              <PlayerMenu
                accountId={row.listing.creatorAccountId}
                listingId={row.listing.id}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}

const filterStyle: CSSProperties = {
  background: c.surfaceAlt,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  color: c.text,
  padding: "8px 11px",
  fontSize: 12,
};

function joinRoleChoices(
  row: BoardRow,
  primary?: string | null,
  secondary?: string | null
): Role[] {
  const open = row.listing.slots.filter((s) => s.open);
  if (!open.length) return [];
  if (open.every((s) => !s.roles || s.roles.length === 0)) return [];
  const prefs = [primary, secondary].filter(
    (r): r is Role => !!r && (ALL_ROLES as readonly string[]).includes(r)
  );
  const accepted: Role[] = [];
  for (const role of prefs) {
    if (open.some((s) => slotAcceptsRole(s.roles, role)) && !accepted.includes(role)) {
      accepted.push(role);
    }
  }
  if (accepted.length) return accepted;
  const fallback = open.find((s) => s.roles.length > 0)?.roles[0];
  return fallback ? [fallback] : [];
}

function JoinButton({
  row,
  busy,
  choices,
  picked,
  onPick,
  openLabel,
  onJoin,
}: {
  row: BoardRow;
  busy: boolean;
  choices: Role[];
  picked?: Role;
  onPick: (role: Role) => void;
  openLabel: string;
  onJoin: (role?: string) => void;
}) {
  const role = choices.length > 1 ? (picked ?? choices[0]) : choices[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
      {choices.length > 1 && (
        <select
          value={role}
          onChange={(e) => onPick(e.target.value as Role)}
          style={{ ...filterStyle, padding: "4px 8px" }}
        >
          {choices.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      )}
      <Button
        variant="primary"
        disabled={busy || !row.eligible}
        title={!row.eligible ? row.reasons.map(eligibilityReasonText).join(", ") : undefined}
        onClick={() => onJoin(role)}
      >
        {busy ? "Sending…" : !row.eligible ? "Can't join" : choices.length ? `Join ${role}` : `Join ${openLabel}`}
      </Button>
    </div>
  );
}

function expiryLabel(iso: string): string | null {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Expired";
  const m = Math.ceil(ms / 60_000);
  if (m > 120) return null;
  return m >= 60 ? `${Math.floor(m / 60)}h left` : `${m}m left`;
}

function MatchScore({ score }: { score: number }) {
  const col = score >= 75 ? c.win : score >= 50 ? c.accent : c.textDim;
  const size = 56;
  const r = 23;
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.surfaceAlt} strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: font.mono,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800, color: col, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 8, color: c.textFaint, letterSpacing: 0.4 }}>MATCH</span>
      </div>
    </div>
  );
}
