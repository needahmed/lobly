import { useMemo, type ReactNode } from "react";
import type { MatchHistoryRow } from "@lobly/shared-types";
import type { StaticData } from "../api/session";
import { c, font, radius } from "./theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  RoleIcon,
  SectionTitle,
  Tag,
} from "./components";
import { championDisplayName, championIcon, useStaticData } from "./useStaticData";

export interface ProfileAnalyticsProps {
  rows: MatchHistoryRow[] | null;
  error?: string | null;
  queueLabel: string;
  fetchedCount: number;
  onRetry?: () => void;
}

interface Summary {
  games: number;
  wins: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  killParticipation: number | null;
  csPerMin: number;
  goldPerMin: number;
  damagePerMin: number;
  damageShare: number | null;
  visionPerMin: number;
}

interface ChampionPerformance {
  championId: number;
  championName: string | null;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  streak: number;
}

export function ProfileAnalytics({
  rows,
  error,
  queueLabel,
  fetchedCount,
  onRetry,
}: ProfileAnalyticsProps) {
  const sd = useStaticData();
  const analytics = useMemo(() => (rows?.length ? buildAnalytics(rows) : null), [rows]);

  if (rows === null && !error) {
    return (
      <Card>
        <LoadingBlock label="Building recent-match analytics" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          title="Analytics are temporarily unavailable"
          hint={`LOBLY couldn't load your recent matches: ${error}`}
          action={
            onRetry ? (
              <Button variant="ghost" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  if (!rows?.length || !analytics) {
    return (
      <Card>
        <EmptyState
          title={`No ${queueLabel.toLowerCase()} matches in this sample`}
          hint={
            fetchedCount
              ? `Try another queue. This view is filtered from your latest ${fetchedCount} fetched matches.`
              : "Play a game and LOBLY will build this view after the match is imported."
          }
        />
      </Card>
    );
  }

  const { summary, champions, roles, currentStreak, trend, comparison } = analytics;
  const sampleLabel =
    queueLabel === "All queues"
      ? `Last ${summary.games} matches`
      : `${summary.games} ${queueLabel} matches within latest ${fetchedCount}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        style={{
          background: `linear-gradient(135deg, ${c.primarySoft}, ${c.surface} 45%)`,
          overflow: "hidden",
        }}
      >
        <SectionTitle
          right={
            <Tag color={c.accent}>
              {sampleLabel}
            </Tag>
          }
        >
          Recent performance
        </SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
            gap: 8,
          }}
        >
          <Metric
            label="Win rate"
            value={`${summary.winRate.toFixed(0)}%`}
            detail={`${summary.wins}W · ${summary.games - summary.wins}L`}
            color={summary.winRate >= 50 ? c.win : c.loss}
          />
          <Metric
            label="KDA"
            value={formatKda(summary.kda)}
            detail={`${summary.kills.toFixed(1)} / ${summary.deaths.toFixed(1)} / ${summary.assists.toFixed(1)} avg`}
            color={kdaTone(summary.kda)}
          />
          <Metric
            label="Kill participation"
            value={formatNullable(summary.killParticipation, "%")}
            detail="average when available"
          />
          <Metric label="CS / min" value={summary.csPerMin.toFixed(1)} detail="average pace" />
          <Metric
            label="Gold / min"
            value={Math.round(summary.goldPerMin).toLocaleString()}
            detail="average income"
            color={c.gold}
          />
          <Metric
            label="Damage / min"
            value={Math.round(summary.damagePerMin).toLocaleString()}
            detail="to champions"
            color={c.accent}
          />
          <Metric
            label="Team damage"
            value={formatNullable(summary.damageShare, "%")}
            detail="average share"
          />
          <Metric
            label="Vision / min"
            value={summary.visionPerMin.toFixed(2)}
            detail="average pace"
          />
        </div>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 12,
        }}
      >
        <TrendCard rows={rows} trend={trend} currentStreak={currentStreak} />
        <PlaystyleCard summary={summary} roles={roles} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 12,
        }}
      >
        <ChampionCard champions={champions} sd={sd} />
        <ComparisonCard comparison={comparison} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  color?: string;
}) {
  return (
    <div
      style={{
        minHeight: 88,
        padding: "12px 13px",
        background: `${c.bg}99`,
        border: `1px solid ${c.border}`,
        borderRadius: radius.md,
      }}
    >
      <div
        style={{
          color: c.textFaint,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.7,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 5,
          color: color ?? c.text,
          fontFamily: font.mono,
          fontSize: 20,
          fontWeight: 750,
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 3, color: c.textDim, fontSize: 10 }}>{detail}</div>
    </div>
  );
}

function TrendCard({
  rows,
  trend,
  currentStreak,
}: {
  rows: MatchHistoryRow[];
  trend: { winRate: number[]; kda: (number | null)[] };
  currentStreak: number;
}) {
  return (
    <Card>
      <SectionTitle
        right={
          currentStreak !== 0 ? (
            <Tag color={currentStreak > 0 ? c.win : c.loss}>
              {Math.abs(currentStreak)} {currentStreak > 0 ? "win" : "loss"} streak
            </Tag>
          ) : undefined
        }
      >
        Form trend
      </SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TrendLine
          label="Rolling 5-game WR"
          values={trend.winRate}
          color={c.primary}
          domain={[0, 100]}
          value={`${trend.winRate.at(-1)?.toFixed(0) ?? "—"}%`}
        />
        <TrendLine
          label="Rolling 5-game KDA"
          values={trend.kda}
          color={c.accent}
          value={formatKda(trend.kda.at(-1) ?? null)}
        />
        <div style={{ display: "flex", gap: 3 }} aria-label="Match results, oldest to newest">
          {[...rows].reverse().map((row) => (
            <span
              key={row.matchId}
              title={`${row.win ? "Win" : "Loss"} · ${row.kills}/${row.deaths}/${row.assists}`}
              style={{
                height: 5,
                flex: 1,
                minWidth: 2,
                borderRadius: radius.pill,
                background: row.win ? c.win : c.loss,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <div style={{ color: c.textFaint, fontSize: 10 }}>
          Oldest → newest · each point aggregates up to five games
        </div>
      </div>
    </Card>
  );
}

function TrendLine({
  label,
  values,
  color,
  domain,
  value,
}: {
  label: string;
  values: (number | null)[];
  color: string;
  domain?: [number, number];
  value: string;
}) {
  const width = 300;
  const height = 56;
  const points = values
    .map((entry, index) => ({ entry, index }))
    .filter((point): point is { entry: number; index: number } => point.entry != null);
  const observed = points.map((point) => point.entry);
  const min = domain?.[0] ?? Math.min(...observed);
  const max = domain?.[1] ?? Math.max(...observed);
  const span = Math.max(max - min, 0.5);
  const path = points
    .map(({ entry, index }, pointIndex) => {
      const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - 4 - ((entry - min) / span) * (height - 8);
      const previousIndex = pointIndex ? points[pointIndex - 1].index : -2;
      return `${previousIndex === index - 1 ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: c.textDim, fontSize: 11 }}>{label}</span>
        <span style={{ color, fontFamily: font.mono, fontWeight: 700 }}>{value}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} trend`}
        style={{ display: "block", marginTop: 4 }}
      >
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={c.border} />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function PlaystyleCard({
  summary,
  roles,
}: {
  summary: Summary;
  roles: { role: string; games: number; percentage: number }[];
}) {
  const axes = [
    { label: "KP", value: summary.killParticipation ?? 0, max: 100 },
    { label: "CS/m", value: summary.csPerMin, max: 12 },
    { label: "DMG", value: summary.damageShare ?? 0, max: 100 },
    { label: "Vision", value: summary.visionPerMin, max: 3 },
  ];
  const center = 66;
  const maxRadius = 42;
  const points = axes
    .map((axis, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
      const scale = Math.min(Math.max(axis.value / axis.max, 0), 1);
      return `${center + Math.cos(angle) * maxRadius * scale},${center + Math.sin(angle) * maxRadius * scale}`;
    })
    .join(" ");

  return (
    <Card>
      <SectionTitle>Playstyle footprint</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "150px minmax(120px, 1fr)",
          gap: 14,
          alignItems: "center",
        }}
      >
        <svg
          viewBox="0 0 132 132"
          width={150}
          height={150}
          role="img"
          aria-label="Absolute recent playstyle rates"
        >
          {[0.33, 0.66, 1].map((scale) => (
            <polygon
              key={scale}
              points={axes
                .map((_, index) => {
                  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
                  return `${center + Math.cos(angle) * maxRadius * scale},${center + Math.sin(angle) * maxRadius * scale}`;
                })
                .join(" ")}
              fill="none"
              stroke={c.border}
            />
          ))}
          {axes.map((axis, index) => {
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / axes.length;
            const x = center + Math.cos(angle) * maxRadius;
            const y = center + Math.sin(angle) * maxRadius;
            const labelX = center + Math.cos(angle) * 57;
            const labelY = center + Math.sin(angle) * 57 + 3;
            return (
              <g key={axis.label}>
                <line x1={center} y1={center} x2={x} y2={y} stroke={c.border} />
                <text
                  x={labelX}
                  y={labelY}
                  fill={c.textDim}
                  fontSize="8"
                  textAnchor="middle"
                  fontFamily={font.sans}
                >
                  {axis.label}
                </text>
              </g>
            );
          })}
          <polygon
            points={points}
            fill={c.primarySoft}
            stroke={c.primary}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <div style={{ color: c.textDim, fontSize: 11, marginBottom: 8 }}>Role distribution</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {roles.slice(0, 5).map((role) => (
              <div key={role.role}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    color: c.textDim,
                    fontSize: 11,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <RoleIcon role={role.role} size={12} />
                    {roleLabel(role.role)}
                  </span>
                  <span style={{ fontFamily: font.mono }}>{role.percentage.toFixed(0)}%</span>
                </div>
                <div
                  style={{
                    height: 3,
                    marginTop: 3,
                    borderRadius: radius.pill,
                    background: c.surfaceAlt,
                  }}
                >
                  <div
                    style={{
                      width: `${role.percentage}%`,
                      height: "100%",
                      borderRadius: radius.pill,
                      background: c.accent,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ color: c.textFaint, fontSize: 10, lineHeight: 1.5 }}>
        Absolute rates, not percentiles. Radar limits: 100% KP, 12 CS/min, 100% team damage,
        3 vision/min.
      </div>
    </Card>
  );
}

function ChampionCard({
  champions,
  sd,
}: {
  champions: ChampionPerformance[];
  sd: StaticData | null;
}) {
  return (
    <Card>
      <SectionTitle>Champion performance</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {champions.slice(0, 5).map((champion) => {
          const winRate = (champion.wins / champion.games) * 100;
          const kda =
            champion.deaths === 0
              ? null
              : (champion.kills + champion.assists) / champion.deaths;
          return (
            <div
              key={champion.championId}
              style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(90px, 1fr) auto",
                gap: 9,
                alignItems: "center",
                padding: "5px 0",
              }}
            >
              <Avatar
                url={championIcon(sd, champion.championId)}
                size={34}
                alt={championDisplayName(sd, champion.championId, champion.championName)}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 650,
                  }}
                >
                  {championDisplayName(sd, champion.championId, champion.championName)}
                </div>
                <div style={{ color: c.textDim, fontSize: 10, marginTop: 2 }}>
                  {champion.wins}W · {champion.games - champion.wins}L · {formatKda(kda)} KDA
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    color: winRate >= 50 ? c.win : c.loss,
                    fontFamily: font.mono,
                    fontWeight: 700,
                  }}
                >
                  {winRate.toFixed(0)}%
                </div>
                <div style={{ color: champion.streak > 0 ? c.win : c.loss, fontSize: 10 }}>
                  {Math.abs(champion.streak)} {champion.streak > 0 ? "W" : "L"} streak
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ComparisonCard({
  comparison,
}: {
  comparison: {
    recentCount: number;
    priorCount: number;
    deltas: { label: string; value: number | null; suffix: string; digits: number }[];
  };
}) {
  return (
    <Card>
      <SectionTitle
        right={
          <span style={{ color: c.textFaint, fontSize: 10 }}>
            {comparison.recentCount}/5 vs {comparison.priorCount}/5 games
          </span>
        }
      >
        Recent five vs prior five
      </SectionTitle>
      {comparison.priorCount === 0 ? (
        <EmptyState
          title="More matches needed"
          hint="At least six matching games are needed to compare your two recent windows."
        />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(110px, 1fr))",
              gap: 8,
            }}
          >
            {comparison.deltas.map((delta) => {
              const tone =
                delta.value == null || Math.abs(delta.value) < 0.005
                  ? c.textDim
                  : delta.value > 0
                    ? c.win
                    : c.loss;
              return (
                <div
                  key={delta.label}
                  style={{
                    padding: 11,
                    borderRadius: radius.md,
                    background: c.surfaceAlt,
                    border: `1px solid ${c.border}`,
                  }}
                >
                  <div style={{ color: c.textFaint, fontSize: 10 }}>{delta.label}</div>
                  <div
                    style={{
                      marginTop: 5,
                      color: tone,
                      fontFamily: font.mono,
                      fontSize: 17,
                      fontWeight: 700,
                    }}
                  >
                    {formatDelta(delta.value, delta.suffix, delta.digits)}
                  </div>
                </div>
              );
            })}
          </div>
          {(comparison.recentCount < 5 || comparison.priorCount < 5) && (
            <div style={{ color: c.textFaint, fontSize: 10, marginTop: 10 }}>
              Partial windows are shown because fewer than ten matching games were available.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function buildAnalytics(rows: MatchHistoryRow[]) {
  const summary = summarize(rows);
  const championMap = new Map<number, MatchHistoryRow[]>();
  const roleMap = new Map<string, number>();

  for (const row of rows) {
    const championRows = championMap.get(row.championId) ?? [];
    championRows.push(row);
    championMap.set(row.championId, championRows);
    const role = row.teamPosition || "UNKNOWN";
    roleMap.set(role, (roleMap.get(role) ?? 0) + 1);
  }

  const champions = [...championMap.entries()]
    .map(([championId, championRows]): ChampionPerformance => {
      const totals = sumCombat(championRows);
      return {
        championId,
        championName: championRows[0].championName,
        games: championRows.length,
        wins: championRows.filter((row) => row.win).length,
        kills: totals.kills,
        deaths: totals.deaths,
        assists: totals.assists,
        streak: resultStreak(championRows),
      };
    })
    .sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games);

  const roles = [...roleMap.entries()]
    .map(([role, games]) => ({ role, games, percentage: (games / rows.length) * 100 }))
    .sort((a, b) => b.games - a.games);

  const chronological = [...rows].reverse();
  const trend = {
    winRate: chronological.map((_, index) => {
      const window = chronological.slice(Math.max(0, index - 4), index + 1);
      return summarize(window).winRate;
    }),
    kda: chronological.map((_, index) => {
      const window = chronological.slice(Math.max(0, index - 4), index + 1);
      return summarize(window).kda;
    }),
  };

  const recent = rows.slice(0, 5);
  const prior = rows.slice(5, 10);
  const recentSummary = summarize(recent);
  const priorSummary = prior.length ? summarize(prior) : null;
  const comparison = {
    recentCount: recent.length,
    priorCount: prior.length,
    deltas: [
      {
        label: "Win rate",
        value: priorSummary ? recentSummary.winRate - priorSummary.winRate : null,
        suffix: " pp",
        digits: 0,
      },
      {
        label: "KDA",
        value:
          priorSummary?.kda != null && recentSummary.kda != null
            ? recentSummary.kda - priorSummary.kda
            : null,
        suffix: "",
        digits: 2,
      },
      {
        label: "Kill participation",
        value:
          priorSummary?.killParticipation != null && recentSummary.killParticipation != null
            ? recentSummary.killParticipation - priorSummary.killParticipation
            : null,
        suffix: " pp",
        digits: 0,
      },
      {
        label: "CS / min",
        value: priorSummary ? recentSummary.csPerMin - priorSummary.csPerMin : null,
        suffix: "",
        digits: 1,
      },
    ],
  };

  return { summary, champions, roles, currentStreak: resultStreak(rows), trend, comparison };
}

function summarize(rows: MatchHistoryRow[]): Summary {
  if (!rows.length) {
    return {
      games: 0,
      wins: 0,
      winRate: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      kda: null,
      killParticipation: null,
      csPerMin: 0,
      goldPerMin: 0,
      damagePerMin: 0,
      damageShare: null,
      visionPerMin: 0,
    };
  }

  const totals = sumCombat(rows);
  const killParticipation = averageDefined(rows.map((row) => row.killParticipation));
  const damageShare = averageDefined(rows.map((row) => row.damageShare));
  const perMinute = rows.map((row) => {
    const minutes = Math.max(row.gameDuration / 60, 1 / 60);
    return {
      gold: row.gold / minutes,
      damage: row.damageDealt / minutes,
      vision: row.visionScore / minutes,
    };
  });

  return {
    games: rows.length,
    wins: rows.filter((row) => row.win).length,
    winRate: (rows.filter((row) => row.win).length / rows.length) * 100,
    kills: totals.kills / rows.length,
    deaths: totals.deaths / rows.length,
    assists: totals.assists / rows.length,
    kda: totals.deaths === 0 ? null : (totals.kills + totals.assists) / totals.deaths,
    killParticipation,
    csPerMin: average(rows.map((row) => row.csPerMin)),
    goldPerMin: average(perMinute.map((row) => row.gold)),
    damagePerMin: average(perMinute.map((row) => row.damage)),
    damageShare,
    visionPerMin: average(perMinute.map((row) => row.vision)),
  };
}

function sumCombat(rows: MatchHistoryRow[]) {
  return rows.reduce(
    (total, row) => ({
      kills: total.kills + row.kills,
      deaths: total.deaths + row.deaths,
      assists: total.assists + row.assists,
    }),
    { kills: 0, deaths: 0, assists: 0 }
  );
}

function resultStreak(rows: MatchHistoryRow[]): number {
  if (!rows.length) return 0;
  const firstResult = rows[0].win;
  let count = 0;
  for (const row of rows) {
    if (row.win !== firstResult) break;
    count += 1;
  }
  return firstResult ? count : -count;
}

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function averageDefined(values: (number | null)[]): number | null {
  const defined = values.filter((value): value is number => value != null);
  return defined.length ? average(defined) : null;
}

function formatNullable(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value.toFixed(0)}${suffix}`;
}

function formatKda(value: number | null): string {
  return value == null ? "Perfect" : value.toFixed(2);
}

function formatDelta(value: number | null, suffix: string, digits: number): string {
  if (value == null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

function kdaTone(kda: number | null): string {
  if (kda == null || kda >= 5) return c.gold;
  if (kda >= 3) return c.accent;
  return c.text;
}

function roleLabel(role: string): string {
  return (
    {
      TOP: "Top",
      JUNGLE: "Jungle",
      MIDDLE: "Mid",
      BOTTOM: "Bot",
      UTILITY: "Support",
      UNKNOWN: "Unassigned",
    }[role] ?? role
  );
}

