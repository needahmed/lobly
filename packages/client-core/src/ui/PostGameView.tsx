import { useEffect, useState } from "react";
import type { EndorseKind } from "@lobly/shared-types";
import { endorse, fetchMyProfiles } from "../api/session";
import { getBridge } from "../shared/bridge";
import { useAppStore } from "../shared/messaging";
import type { AppState } from "../state/store";
import { c, radius } from "./theme";
import { Button, Card, SectionTitle, Tag } from "./components";
import { MatchHistory } from "./MatchHistory";
import { PlayerMenu } from "./PlayerMenu";

const KINDS: { id: EndorseKind; label: string }[] = [
  { id: "GOOD_COMMS", label: "Comms" },
  { id: "GOOD_TEAMMATE", label: "Teammate" },
  { id: "SKILLED", label: "Skilled" },
];

function hoursLeft(): number {
  return 23;
}

export function PostGameBanner() {
  const state = useAppStore();
  const post = state.postGame;
  if (!post || post.dismissed || post.mode === "hidden") return null;
  if (state.uiTab === "postgame") return null;
  const endorseBlock = post.ready?.endorse;
  return (
    <div
      style={{
        margin: "0 28px",
        marginTop: 12,
        padding: "10px 14px",
        borderRadius: radius.md,
        border: `1px solid ${c.borderStrong}`,
        background: c.primarySoft,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span style={{ flex: 1, fontSize: 13 }}>
        {endorseBlock
          ? `Endorse your last teammates (${hoursLeft()} h left)`
          : "Your last game is ready to review"}
      </span>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          getBridge()?.store.update({
            uiTab: "postgame",
            postGame: { ...post, mode: "full" },
          });
        }}
      >
        Open
      </Button>
      <Button
        size="sm"
        onClick={() =>
          getBridge()?.store.update({
            postGame: { ...post, mode: "hidden", dismissed: true },
          })
        }
      >
        Dismiss
      </Button>
    </div>
  );
}

export function PostGameView() {
  const state = useAppStore();
  const post = state.postGame;
  const [picked, setPicked] = useState<Record<string, EndorseKind[]>>({});
  const [after, setAfter] = useState<{ tier: string | null; division: string | null; lp: number | null } | null>(
    null
  );

  useEffect(() => {
    if (!post?.ready?.profileRefreshed) return;
    let cancel = false;
    void fetchMyProfiles()
      .then((cards) => {
        if (cancel) return;
        const snap = cards[0]?.snapshot?.solo;
        if (!snap) return;
        setAfter({ tier: snap.tier, division: snap.division, lp: snap.lp });
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [post?.ready?.profileRefreshed, post?.ready?.gameId]);

  if (!post) return null;
  const local = post.local;
  const endorseBlock = post.ready?.endorse ?? null;
  const confirmed = post.ready?.riotConfirmed === true;

  const skip = () => {
    getBridge()?.store.update({
      uiTab: state.uiTab === "postgame" ? "listing" : state.uiTab,
      postGame: { ...post, mode: "hidden", dismissed: true },
    });
  };

  const toggle = (accountId: string, kind: EndorseKind) => {
    setPicked((cur) => {
      const have = cur[accountId] ?? [];
      const next = have.includes(kind) ? have.filter((k) => k !== kind) : [...have, kind];
      return { ...cur, [accountId]: next };
    });
  };

  const send = async (accountId: string) => {
    if (!endorseBlock) return;
    const kinds = picked[accountId] ?? [];
    if (!kinds.length) return;
    try {
      await endorse(endorseBlock.sessionId, accountId, kinds, post.gameId ?? undefined);
      getBridge()?.setToast("Endorsement sent");
    } catch (e: any) {
      getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Endorse failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card pad={20}>
        <SectionTitle
          right={
            <Button size="sm" onClick={skip}>
              Skip
            </Button>
          }
        >
          Post-game
        </SectionTitle>
        {!confirmed && (
          <div style={{ color: c.textDim, fontSize: 13, marginBottom: 12 }}>
            Fetching your game from Riot…
          </div>
        )}
        {local && (
          <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <Tag color={local.win ? c.win : c.loss}>{local.win == null ? "Game" : local.win ? "Victory" : "Defeat"}</Tag>
            <span style={{ fontWeight: 700 }}>
              {local.kills ?? 0}/{local.deaths ?? 0}/{local.assists ?? 0}
            </span>
            {local.durationSec != null && (
              <span style={{ color: c.textDim, fontSize: 13 }}>
                {Math.floor(local.durationSec / 60)}m {local.durationSec % 60}s
              </span>
            )}
            {post.queueId != null && <Tag color={c.textDim}>Queue {post.queueId}</Tag>}
          </div>
        )}
        {(post.rankBefore || after) && (
          <div style={{ marginTop: 14, fontSize: 13, color: c.textDim }}>
            Rank {post.rankBefore?.tier ?? "—"} {post.rankBefore?.division ?? ""}
            {after ? ` → ${after.tier ?? "—"} ${after.division ?? ""} ${after.lp ?? ""} LP` : ""}
          </div>
        )}
      </Card>

      {confirmed && state.riotAccountId && (
        <Card pad={8}>
          <MatchHistory riotAccountId={state.riotAccountId} queueId={post.queueId ?? undefined} />
        </Card>
      )}

      {endorseBlock && (
        <Card pad={20}>
          <SectionTitle>Endorse teammates</SectionTitle>
          {endorseBlock.others.map((other) => (
            <div
              key={other.accountId}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "8px 0",
              }}
            >
              <span style={{ fontWeight: 700, minWidth: 140 }}>
                {other.riotId}
                <span style={{ color: c.textFaint }}>#{other.tagLine}</span>
              </span>
              {other.role && <Tag color={c.textDim}>{other.role}</Tag>}
              {KINDS.map((kind) => {
                const on = (picked[other.accountId] ?? []).includes(kind.id);
                return (
                  <Button
                    key={kind.id}
                    size="sm"
                    variant={on ? "primary" : undefined}
                    onClick={() => toggle(other.accountId, kind.id)}
                  >
                    {kind.label}
                  </Button>
                );
              })}
              <Button size="sm" variant="primary" onClick={() => void send(other.accountId)}>
                Send
              </Button>
              <PlayerMenu accountId={other.accountId} sessionId={endorseBlock.sessionId} />
            </div>
          ))}
          <div style={{ marginTop: 8 }}>
            <Button size="sm" onClick={skip}>
              Skip
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export function postGameIsFull(state: AppState): boolean {
  return state.postGame?.mode === "full" && !state.postGame.dismissed;
}
