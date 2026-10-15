import { useEffect, useMemo, useState } from "react";
import type { MatchHistoryRow, ProfileCard } from "@lobly/shared-types";
import { fetchMatchHistory, fetchMyProfiles } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import { c, radius, font, tierColor } from "./theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  RankBadge,
  RoleLabel,
  SectionTitle,
  StatBlock,
  Tag,
  WinRateBar,
  titleCase,
} from "./components";
import { MatchHistory, kdaColor, matchQueueLabel } from "./MatchHistory";
import { ProfileAnalytics } from "./ProfileAnalytics";
import {
  championDisplayName,
  championIcon,
  profileIcon,
  useStaticData,
} from "./useStaticData";

export function ProfileView() {
  const sd = useStaticData();
  const state = useAppStore();
  const [cards, setCards] = useState<ProfileCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchHistoryRow[] | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [queueId, setQueueId] = useState<number | undefined>(undefined);
  const [profileRequest, setProfileRequest] = useState(0);
  const [matchRequest, setMatchRequest] = useState(0);

  // A LOBLY user can have multiple linked Riot accounts (smurfs) — always
  // show the one that's actually logged into the League client right now,
  // never just whichever happened to be linked first.
  const activeAccountId = state.riotAccountId;

  useEffect(() => {
    let alive = true;
    setCards(null);
    setError(null);
    void fetchMyProfiles()
      .then((r) => {
        if (!alive) return;
        setCards(r);
        const card = r.find((x) => x.account.id === activeAccountId) ?? r[0];
        if (card?.snapshot) {
          getBridge()?.store.update({
            profileHints: {
              soloTier: card.snapshot.solo?.tier ?? null,
              soloDivision: card.snapshot.solo?.division ?? null,
              flexTier: card.snapshot.flex?.tier ?? null,
              flexDivision: card.snapshot.flex?.division ?? null,
              primaryRole: card.snapshot.primaryRole,
              secondaryRole: card.snapshot.secondaryRole,
              languages: card.prefs?.languages,
            },
          });
        }
      })
      .catch((e) => alive && setError(e?.message ?? "Failed to load profile"));
    return () => {
      alive = false;
    };
  }, [profileRequest, activeAccountId]);

  const activeCard = useMemo(
    () => cards?.find((x) => x.account.id === activeAccountId) ?? cards?.[0],
    [cards, activeAccountId]
  );
  const accountId = activeCard?.account.id;

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setMatches(null);
    setMatchesError(null);
    void fetchMatchHistory(accountId, { limit: 50 })
      .then((rows) => alive && setMatches(rows))
      .catch((e) => alive && setMatchesError(e?.message ?? "Failed to load recent matches"));
    return () => {
      alive = false;
    };
  }, [accountId, matchRequest]);

  const filteredMatches = useMemo(
    () => (matches && queueId != null ? matches.filter((row) => row.queueId === queueId) : matches),
    [matches, queueId]
  );

  if (error) {
    return (
      <Card>
        <EmptyState
          title="Couldn't load your profile"
          hint={error}
          action={
            <Button variant="ghost" onClick={() => setProfileRequest((request) => request + 1)}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }
  if (!cards) return <Card><LoadingBlock label="Loading profile" /></Card>;
  if (!cards.length) {
    return (
      <Card>
        <EmptyState
          title="No Riot account linked yet"
          hint="Sign in to the League client while LOBLY is running — your account links automatically, no password needed."
        />
      </Card>
    );
  }

  const card = activeCard ?? cards[0];
  const snap = card.snapshot;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ---------------------------------------------------- header */}
      <Card
        pad={0}
        style={{
          overflow: "hidden",
          borderRadius: radius.xl,
          background: c.surface,
        }}
      >
        <div
          style={{
            background: `
              radial-gradient(circle at 12% 10%, ${c.primarySoft}, transparent 34%),
              linear-gradient(120deg, ${c.surfaceAlt}, ${c.surface} 58%)
            `,
            padding: 24,
            display: "flex",
            gap: 20,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Avatar
            url={profileIcon(sd, snap?.profileIconId)}
            size={84}
            ring={tierColor(snap?.solo.tier)}
          />
          <div style={{ minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 750, letterSpacing: -0.5 }}>
                {card.account.riotId}
              </span>
              <span style={{ fontSize: 15, color: c.textDim }}>#{card.account.tagLine}</span>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Tag color={c.textDim}>{card.account.platform.toUpperCase()}</Tag>
              {snap?.summonerLevel != null && (
                <Tag color={c.textDim}>Level {snap.summonerLevel}</Tag>
              )}
              {snap?.primaryRole && (
                <Tag color={c.accent}>
                  <RoleLabel role={snap.primaryRole} />
                </Tag>
              )}
              {card.reputation?.provisional && <Tag color={c.warn}>Provisional</Tag>}
              {card.account.verifiedAt && <Tag color={c.win}>✓ Verified</Tag>}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 28,
              marginLeft: "auto",
              flexWrap: "wrap",
              padding: "13px 16px",
              background: `${c.bg}99`,
              border: `1px solid ${c.border}`,
              borderRadius: radius.lg,
            }}
          >
            <StatBlock
              label="Form (20g)"
              value={snap?.formWr20 != null ? `${snap.formWr20}%` : "—"}
              color={
                snap?.formWr20 == null
                  ? c.textDim
                  : snap.formWr20 >= 50
                    ? c.win
                    : c.loss
              }
              sub="win rate"
            />
            <StatBlock
              label="Streak"
              value={
                snap?.streak
                  ? `${snap.streak > 0 ? "+" : ""}${snap.streak}`
                  : "—"
              }
              color={
                !snap?.streak ? c.textDim : snap.streak > 0 ? c.win : c.loss
              }
              sub={snap?.streak ? (snap.streak > 0 ? "wins" : "losses") : undefined}
            />
            <StatBlock
              label="Reliability"
              value={card.reputation?.reliability ?? "New"}
              color={c.primary}
              sub="LOBLY score"
            />
          </div>
        </div>
      </Card>

      {/* -------------------------------------------- ranks + champions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <Card>
          <SectionTitle>Ranked</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <QueueRank label="Solo / Duo" rank={snap?.solo} />
            <QueueRank label="Flex 5v5" rank={snap?.flex} />
          </div>
          {snap && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${c.border}`,
                display: "flex",
                gap: 24,
              }}
            >
              <StatBlock label="Primary" value={<RoleLabel role={snap.primaryRole} />} />
              <StatBlock label="Secondary" value={<RoleLabel role={snap.secondaryRole} />} />
              <StatBlock label="Games" value={snap.gamesThisSeason ?? 0} sub="ranked" />
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Top champions</SectionTitle>
          {!card.champions.length && (
            <div style={{ color: c.textFaint, padding: "12px 0" }}>No champion data yet.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {card.champions.slice(0, 6).map((ch) => {
              const wr = ch.games ? Math.round((ch.wins / ch.games) * 100) : 0;
              return (
                <div
                  key={ch.championId}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <Avatar url={championIcon(sd, ch.championId)} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {championDisplayName(sd, ch.championId, ch.name)}
                      </span>
                      <span
                        style={{
                          fontFamily: font.mono,
                          fontSize: 12,
                          color: kdaColor(ch.kda),
                          fontWeight: 700,
                        }}
                      >
                        {Number(ch.kda).toFixed(2)} KDA
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 3,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <WinRateBar wins={ch.wins} losses={ch.games - ch.wins} height={4} />
                      </div>
                      <span style={{ fontSize: 11, color: c.textDim, minWidth: 74 }}>
                        {wr}% · {ch.games}g
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ----------------------------------------- analytics + match history */}
      <div>
        <SectionTitle>Performance analytics</SectionTitle>
        <ProfileAnalytics
          rows={filteredMatches}
          error={matchesError}
          queueLabel={matchQueueLabel(queueId)}
          fetchedCount={matches?.length ?? 0}
          onRetry={() => setMatchRequest((request) => request + 1)}
        />
      </div>

      <div>
        <SectionTitle>Match history</SectionTitle>
        <MatchHistory
          riotAccountId={card.account.id}
          rows={filteredMatches}
          error={matchesError}
          queueId={queueId}
          onQueueChange={setQueueId}
          fetchedCount={matches?.length ?? 0}
        />
      </div>

      <PrefsCard card={card} />
    </div>
  );
}

function QueueRank({
  label,
  rank,
}: {
  label: string;
  rank?: { tier: string | null; division: string | null; lp: number | null; wins: number | null; losses: number | null };
}) {
  const wins = rank?.wins ?? 0;
  const losses = rank?.losses ?? 0;
  const total = wins + losses;
  const wr = total ? Math.round((wins / total) * 100) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: c.textDim, fontSize: 12 }}>{label}</span>
        <RankBadge tier={rank?.tier} division={rank?.division} lp={rank?.lp} />
      </div>
      {total > 0 && (
        <>
          <div style={{ marginTop: 6 }}>
            <WinRateBar wins={wins} losses={losses} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
              fontSize: 11,
              color: c.textDim,
            }}
          >
            <span>
              <span style={{ color: c.win }}>{wins}W</span>{" "}
              <span style={{ color: c.loss }}>{losses}L</span>
            </span>
            <span style={{ color: wr >= 50 ? c.win : c.loss, fontWeight: 700 }}>{wr}%</span>
          </div>
        </>
      )}
    </div>
  );
}

function PrefsCard({ card }: { card: ProfileCard }) {
  if (!card.reputation) return null;
  return (
    <Card>
      <SectionTitle>Reputation</SectionTitle>
      {card.reputation && (
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 14,
            paddingTop: 12,
            borderTop: `1px solid ${c.border}`,
            flexWrap: "wrap",
          }}
        >
          <Tag color={c.accent}>
            {card.reputation.endorsements.goodComms} Good comms
          </Tag>
          <Tag color={c.win}>
            {card.reputation.endorsements.goodTeammate} Good teammate
          </Tag>
          <Tag color={c.gold}>{card.reputation.endorsements.skilled} Skilled</Tag>
        </div>
      )}
    </Card>
  );
}

export { titleCase };
