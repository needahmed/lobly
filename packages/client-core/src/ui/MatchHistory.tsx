import { useEffect, useState } from "react";
import { queueName, type MatchHistoryRow, type MatchScoreboardEntry } from "@lobly/shared-types";
import { fetchMatchHistory } from "../api/session";
import { c, radius, font } from "./theme";
import {
  Avatar,
  Card,
  EmptyState,
  LoadingBlock,
  RoleIcon,
  Tag,
} from "./components";
import {
  championDisplayName,
  championIcon,
  itemIcon,
  runeIcon,
  spellIcon,
  useStaticData,
} from "./useStaticData";
import type { StaticData } from "../api/session";

export const MATCH_QUEUE_FILTERS: { label: string; analyticsLabel: string; queueId?: number }[] = [
  { label: "All", analyticsLabel: "All queues" },
  { label: "Ranked Solo", analyticsLabel: "Ranked Solo", queueId: 420 },
  { label: "Flex", analyticsLabel: "Flex", queueId: 440 },
  { label: "ARAM", analyticsLabel: "ARAM", queueId: 450 },
];

export interface MatchHistoryProps {
  riotAccountId?: string;
  /** Supplying rows makes the component controlled and prevents its own initial request. */
  rows?: MatchHistoryRow[] | null;
  error?: string | null;
  queueId?: number;
  onQueueChange?: (queueId?: number) => void;
  /** Total unfiltered rows in the shared profile sample. */
  fetchedCount?: number;
}

export function matchQueueLabel(queueId?: number): string {
  return (
    MATCH_QUEUE_FILTERS.find((filter) => filter.queueId === queueId)?.analyticsLabel ??
    queueName(queueId ?? 0)
  );
}

export function MatchHistory({
  riotAccountId,
  rows: controlledRows,
  error: controlledError,
  queueId: controlledQueueId,
  onQueueChange,
  fetchedCount,
}: MatchHistoryProps) {
  const sd = useStaticData();
  const [localRows, setLocalRows] = useState<MatchHistoryRow[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localQueueId, setLocalQueueId] = useState<number | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const isControlled = controlledRows !== undefined;
  const rows = isControlled ? controlledRows : localRows;
  const error = isControlled ? controlledError ?? null : localError;
  const queueId = isControlled ? controlledQueueId : localQueueId;

  useEffect(() => {
    if (isControlled || !riotAccountId) return;
    let alive = true;
    setLocalRows(null);
    setLocalError(null);
    void fetchMatchHistory(riotAccountId, { limit: 50, queueId })
      .then((r) => alive && setLocalRows(r))
      .catch((e) => alive && setLocalError(e?.message ?? "Failed to load matches"));
    return () => {
      alive = false;
    };
  }, [isControlled, riotAccountId, queueId]);

  if (!riotAccountId) {
    return (
      <Card>
        <EmptyState
          title="No account linked"
          hint="Open the League client and sign in — LOBLY links your account automatically."
        />
      </Card>
    );
  }

  const agg = rows?.length ? aggregate(rows) : null;
  const sampleCount = fetchedCount ?? rows?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        pad={10}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          background: c.surfaceAlt,
        }}
      >
        {MATCH_QUEUE_FILTERS.map((f) => {
          const active = f.queueId === queueId;
          return (
            <button
              key={f.label}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setExpanded(null);
                if (isControlled) onQueueChange?.(f.queueId);
                else setLocalQueueId(f.queueId);
              }}
              style={{
                background: active ? c.primarySoft : "transparent",
                color: active ? c.text : c.textDim,
                border: `1px solid ${active ? c.primary : c.border}`,
                borderRadius: radius.pill,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {f.label}
            </button>
          );
        })}
        <span style={{ color: c.textFaint, fontSize: 10 }}>
          {rows ? `${rows.length} shown from ${sampleCount} fetched` : `Up to ${sampleCount || 50} recent`}
        </span>
        {agg && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 12,
              color: c.textDim,
            }}
          >
            <span>
              <strong style={{ color: c.win }}>{agg.wins}W</strong>{" "}
              <strong style={{ color: c.loss }}>{agg.losses}L</strong>
            </span>
            <span>
              WR <strong style={{ color: c.text }}>{agg.winRate}%</strong>
            </span>
            <span>
              KDA{" "}
              <strong style={{ color: kdaColor(agg.kda) }}>
                {agg.kda == null ? "Perfect" : agg.kda}
              </strong>
            </span>
          </div>
        )}
      </Card>

      {rows === null && !error && <Card><LoadingBlock label="Loading matches" /></Card>}
      {error && (
        <Card>
          <EmptyState title="Couldn't load matches" hint={error} />
        </Card>
      )}
      {rows?.length === 0 && (
        <Card>
          <EmptyState
            title={
              queueId == null
                ? "No matches yet"
                : `No ${matchQueueLabel(queueId)} matches in this sample`
            }
            hint={
              queueId == null
                ? "Play a game and LOBLY will pull it in automatically after it ends."
                : `Try another queue. Filters use the latest ${sampleCount} fetched matches without making another request.`
            }
          />
        </Card>
      )}

      {rows?.map((m) => (
        <MatchRow
          key={m.matchId}
          m={m}
          sd={sd}
          expanded={expanded === m.matchId}
          onToggle={() => setExpanded(expanded === m.matchId ? null : m.matchId)}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- one match */

function MatchRow({
  m,
  sd,
  expanded,
  onToggle,
}: {
  m: MatchHistoryRow;
  sd: StaticData | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const accent = m.win ? c.win : c.loss;
  const champName = championDisplayName(sd, m.championId, m.championName);

  return (
    <div
      className="lobly-fade"
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: radius.lg,
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${m.win ? "Victory" : "Defeat"} as ${champName}, ${m.kills} kills, ${m.deaths} deaths, ${m.assists} assists`}
        className="lobly-row"
        style={{
          display: "grid",
          gridTemplateColumns: "96px 56px minmax(150px, 1fr) auto 92px",
          gap: 14,
          alignItems: "center",
          padding: "12px 14px",
          cursor: "pointer",
          background: m.win ? `${c.win}08` : `${c.loss}08`,
        }}
      >
        {/* result + queue */}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: accent, fontWeight: 700, fontSize: 13 }}>
            {m.win ? "Victory" : "Defeat"}
          </div>
          <div style={{ color: c.textDim, fontSize: 11, marginTop: 2 }}>
            {queueName(m.queueId)}
          </div>
          <div style={{ color: c.textFaint, fontSize: 11, marginTop: 1 }}>
            {timeAgo(m.gameCreation)} · {formatDuration(m.gameDuration)}
          </div>
        </div>

        {/* champion + spells + runes */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ position: "relative" }}>
            <Avatar url={championIcon(sd, m.championId)} size={44} alt={champName} />
            {m.champLevel != null && (
              <span
                style={{
                  position: "absolute",
                  bottom: -3,
                  right: -3,
                  background: c.bg,
                  border: `1px solid ${c.borderStrong}`,
                  borderRadius: "50%",
                  width: 18,
                  height: 18,
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: c.textDim,
                }}
              >
                {m.champLevel}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <MiniIcon url={spellIcon(sd, m.summoner1Id)} />
            <MiniIcon url={spellIcon(sd, m.summoner2Id)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <MiniIcon url={runeIcon(sd, m.primaryRune)} round />
            <MiniIcon url={runeIcon(sd, m.subStyle)} round />
          </div>
        </div>

        {/* KDA + stats */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 0.3,
            }}
          >
            {m.kills}
            <span style={{ color: c.textFaint }}> / </span>
            <span style={{ color: c.loss }}>{m.deaths}</span>
            <span style={{ color: c.textFaint }}> / </span>
            {m.assists}
          </div>
          <div style={{ fontSize: 11, color: c.textDim, marginTop: 2 }}>
            <span style={{ color: kdaColor(m.kda), fontWeight: 700 }}>
              {m.kda == null ? "Perfect" : `${m.kda.toFixed(2)}`}
            </span>{" "}
            KDA
            {m.killParticipation != null && ` · ${m.killParticipation}% KP`}
          </div>
          <div style={{ fontSize: 11, color: c.textFaint, marginTop: 1 }}>
            {m.cs} CS ({m.csPerMin.toFixed(1)}/m) · {(m.gold / 1000).toFixed(1)}k gold
            {m.visionScore > 0 && ` · ${m.visionScore} vision`}
          </div>
        </div>

        {/* items */}
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {m.items.slice(0, 6).map((id, i) => (
            <ItemSlot key={i} url={itemIcon(sd, id)} />
          ))}
          <div style={{ width: 6 }} />
          <ItemSlot url={itemIcon(sd, m.items[6] ?? 0)} round />
        </div>

        {/* badges */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            minWidth: 92,
          }}
        >
          {m.multikill >= 2 && (
            <Tag color={c.warn}>{MULTIKILL_LABEL[m.multikill] ?? "Multikill"}</Tag>
          )}
          {m.damageShare != null && m.damageShare >= 30 && (
            <Tag color={c.accent}>{m.damageShare}% DMG</Tag>
          )}
          {m.teamPosition && (
            <span style={{ color: c.textFaint, display: "flex", gap: 4, fontSize: 11 }}>
              <RoleIcon role={m.teamPosition} size={13} color={c.textFaint} />
            </span>
          )}
          <span style={{ color: c.textFaint, fontSize: 16, lineHeight: 1 }}>
            {expanded ? "⌃" : "⌄"}
          </span>
        </div>
      </div>

      {expanded && <Scoreboard m={m} sd={sd} />}
    </div>
  );
}

/* ------------------------------------------------------------ scoreboard */

function Scoreboard({ m, sd }: { m: MatchHistoryRow; sd: StaticData | null }) {
  const maxDamage = Math.max(
    1,
    ...[...m.teammates, ...m.opponents].map((p) => p.damageDealt)
  );
  return (
    <div
      className="lobly-fade"
      style={{
        borderTop: `1px solid ${c.border}`,
        background: c.bg,
        padding: 12,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      <TeamColumn
        title={m.win ? "Victory" : "Defeat"}
        color={m.win ? c.win : c.loss}
        players={m.teammates}
        sd={sd}
        maxDamage={maxDamage}
      />
      <TeamColumn
        title={m.win ? "Defeat" : "Victory"}
        color={m.win ? c.loss : c.win}
        players={m.opponents}
        sd={sd}
        maxDamage={maxDamage}
      />
    </div>
  );
}

function TeamColumn({
  title,
  color,
  players,
  sd,
  maxDamage,
}: {
  title: string;
  color: string;
  players: MatchScoreboardEntry[];
  sd: StaticData | null;
  maxDamage: number;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {players.map((p) => (
          <div
            key={p.puuid}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr 62px 46px",
              gap: 8,
              alignItems: "center",
              padding: "4px 6px",
              borderRadius: radius.sm,
              background: p.isMe ? c.primarySoft : "transparent",
              fontSize: 11,
            }}
          >
            <Avatar url={championIcon(sd, p.championId)} size={24} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: p.isMe ? c.text : c.textDim,
                  fontWeight: p.isMe ? 700 : 500,
                }}
              >
                {p.riotId}
              </div>
              <div style={{ height: 3, marginTop: 3, background: c.surfaceAlt, borderRadius: 2 }}>
                <div
                  style={{
                    width: `${(p.damageDealt / maxDamage) * 100}%`,
                    height: "100%",
                    background: p.isMe ? c.primary : c.borderStrong,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
            <div style={{ fontFamily: font.mono, color: c.textDim, textAlign: "right" }}>
              {p.kills}/{p.deaths}/{p.assists}
            </div>
            <div style={{ color: c.textFaint, textAlign: "right" }}>{p.cs} cs</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- atoms */

function MiniIcon({ url, round }: { url?: string | null; round?: boolean }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: round ? "50%" : radius.sm,
        background: c.surfaceAlt,
        overflow: "hidden",
        border: `1px solid ${c.border}`,
      }}
    >
      {url && <img src={url} width={20} height={20} alt="" style={{ display: "block" }} />}
    </div>
  );
}

function ItemSlot({ url, round }: { url?: string | null; round?: boolean }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: round ? "50%" : radius.sm,
        background: c.surfaceAlt,
        border: `1px solid ${c.border}`,
        overflow: "hidden",
      }}
    >
      {url && <img src={url} width={26} height={26} alt="" style={{ display: "block" }} />}
    </div>
  );
}

/* ----------------------------------------------------------------- utils */

const MULTIKILL_LABEL: Record<number, string> = {
  2: "Double Kill",
  3: "Triple Kill",
  4: "Quadra Kill",
  5: "PENTAKILL",
};

export function kdaColor(kda: number | null): string {
  if (kda == null) return c.gold;
  if (kda >= 5) return c.gold;
  if (kda >= 3) return c.accent;
  if (kda >= 2) return c.text;
  return c.textDim;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function aggregate(rows: MatchHistoryRow[]) {
  const wins = rows.filter((r) => r.win).length;
  const losses = rows.length - wins;
  const k = rows.reduce((s, r) => s + r.kills, 0);
  const d = rows.reduce((s, r) => s + r.deaths, 0);
  const a = rows.reduce((s, r) => s + r.assists, 0);
  return {
    wins,
    losses,
    winRate: rows.length ? Math.round((wins / rows.length) * 100) : 0,
    kda: d === 0 ? null : Number(((k + a) / d).toFixed(2)),
  };
}
