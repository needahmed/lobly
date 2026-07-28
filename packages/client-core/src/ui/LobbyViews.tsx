import { useEffect, useMemo, useState } from "react";
import {
  ListingStatus,
  displayQueueLabel,
} from "@lobly/shared-types";
import {
  acceptJoin,
  declineJoin,
  endorse,
  fetchListingRequests,
  patchListing,
} from "../api/session";
import { getBridge, type LoblyBridge } from "../shared/bridge";
import type { AppState } from "../state/store";
import {
  draftToSlots,
  saveDraftForQueue,
  type PublishDraft,
} from "../state/publishDraft";
import { c, radius, font } from "./theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  RankBadge,
  RoleIcon,
  SectionTitle,
  StatBlock,
  Tag,
} from "./components";
import { championIcon, useStaticData } from "./useStaticData";
import { PublishForm } from "./PublishForm";

/* ------------------------------------------------------------- My Lobby */

export function ListingView({
  state,
  bridge,
}: {
  state: AppState;
  bridge: LoblyBridge | null;
}) {
  const lobby = state.lobby as any;
  const cap = state.lobbyCapability;
  const queueId = cap?.queueId ?? lobby?.gameConfig?.queueId ?? lobby?.queueId;
  const check = bridge?.canPublish() ?? { ok: false, reason: "Not connected" };
  const status = state.listing.status;
  const live =
    status === ListingStatus.LISTED ||
    status === ListingStatus.FILLING ||
    status === ListingStatus.READY ||
    status === ListingStatus.PAUSED;
  const [editing, setEditing] = useState(false);
  const draft = state.publishDraft;

  const expiresLabel = useMemo(() => {
    const exp = state.myListing?.expiresAt;
    if (!exp) return null;
    const ms = Date.parse(exp) - Date.now();
    if (ms <= 0) return "Expired";
    const m = Math.ceil(ms / 60_000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
  }, [state.myListing?.expiresAt, state.boardRevision]);

  const extend = async () => {
    const id = state.listing.id;
    if (!id || !draft) return;
    try {
      const summary = await patchListing(id, { durationMin: draft.durationMin });
      getBridge()?.store.update({ myListing: summary });
      getBridge()?.setToast("Listing extended");
    } catch (e: any) {
      getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Extend failed");
    }
  };

  const saveEdit = async (draft: PublishDraft) => {
    const id = state.listing.id;
    if (!id || !cap) return;
    try {
      saveDraftForQueue(cap.queueId, draft);
      const summary = await patchListing(id, {
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        filters: draft.filters,
        slots: draftToSlots(draft),
        voiceRequired: draft.voiceRequired,
        languages: draft.languages,
        durationMin: draft.durationMin,
      });
      getBridge()?.store.update({ myListing: summary });
      setEditing(false);
      getBridge()?.setToast("Listing updated");
    } catch (e: any) {
      getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Save failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        pad={20}
        style={{
          background: lobby
            ? "radial-gradient(circle at 88% 0%, rgba(69,230,174,.13), transparent 34%), linear-gradient(135deg, rgba(14,29,43,.98), rgba(7,13,22,.98))"
            : undefined,
          overflow: "hidden",
        }}
      >
        <SectionTitle
          right={
            <Tag color={live ? c.win : c.textDim} bg={live ? c.winSoft : undefined}>
              {status}
            </Tag>
          }
        >
          Detected League lobby
        </SectionTitle>

        {lobby && cap ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(130px, 1fr))",
              gap: 14,
            }}
          >
            <StatBlock
              label="Queue"
              value={displayQueueLabel(Number(queueId), cap)}
              sub={`ID ${queueId}`}
            />
            <StatBlock
              label="Members"
              value={`${cap.memberCount}/${cap.maxLobbySize}`}
              sub={`${cap.freeSeats} free`}
            />
            <StatBlock
              label="Fill style"
              value={cap.positional ? "Roles" : "Open"}
              sub={cap.isCustom ? "Custom" : cap.gameMode ?? "—"}
            />
            <StatBlock label="Phase" value={state.gameflowPhase} />
          </div>
        ) : (
          <EmptyState
            title="No League lobby open"
            hint="Create a lobby in the League client and it will appear here automatically — Solo/Duo, Flex, ARAM, Mayhem, Custom, and more."
          />
        )}
      </Card>

      <Card pad={20} style={{ background: "rgba(9,15,25,.9)" }}>
        {draft && cap ? (
          <>
            {live && !editing && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <Tag color={c.win}>Live on Find Team</Tag>
                {expiresLabel && <Tag color={c.textDim}>{expiresLabel}</Tag>}
                <Button size="sm" onClick={() => setEditing(true)} style={{ marginLeft: "auto" }}>
                  Edit
                </Button>
                <Button size="sm" onClick={extend}>
                  Extend
                </Button>
              </div>
            )}
            {(editing || !live) && (
              <PublishForm
                initialDraft={draft}
                cap={cap}
                live={live}
                editing={editing}
                creatorTier={
                  cap.rankSource === "flex"
                    ? state.profileHints?.flexTier
                    : state.profileHints?.soloTier
                }
                creatorDivision={
                  cap.rankSource === "flex"
                    ? state.profileHints?.flexDivision
                    : state.profileHints?.soloDivision
                }
                canPublishOk={check.ok}
                publishReason={check.reason ?? state.publishReason}
                status={status}
                onPublish={(d) => {
                  if (bridge?.publish) bridge.publish(d);
                  else bridge?.dispatch({ type: "PUBLISH" });
                }}
                onUnpublish={() => {
                  setEditing(false);
                  bridge?.dispatch({ type: "UNPUBLISH" });
                }}
                onSaveEdit={saveEdit}
                onQueueAgain={() => bridge?.dispatch({ type: "QUEUE_AGAIN" })}
              />
            )}
            {live && !editing && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <Button onClick={() => bridge?.dispatch({ type: "UNPUBLISH" })}>
                  Unpublish
                </Button>
                {status === ListingStatus.PAUSED && (
                  <Button onClick={() => bridge?.dispatch({ type: "QUEUE_AGAIN" })}>
                    Queue again
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <SectionTitle>Publish to LOBLY</SectionTitle>
            {!check.ok && (
              <div
                style={{
                  background: c.lossSoft,
                  border: `1px solid ${c.loss}33`,
                  color: c.loss,
                  borderRadius: radius.md,
                  padding: "9px 12px",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {check.reason}
              </div>
            )}
            <EmptyState
              title="Open a lobby to publish"
              hint="Once League reports a lobby, you'll configure roles, rank range, and how many seats you need."
            />
          </>
        )}
      </Card>

      {state.manualInvite && (
        <Card style={{ borderColor: `${c.warn}55` }}>
          <SectionTitle>Manual invite needed</SectionTitle>
          <p style={{ color: c.textDim, margin: "0 0 10px", lineHeight: 1.6 }}>
            LOBLY couldn't send the League invite automatically. Invite this player
            from your League client:
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: radius.sm,
                padding: "7px 12px",
                fontFamily: font.mono,
                fontSize: 13,
              }}
            >
              {state.manualInvite.riotId}
            </code>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(state.manualInvite!.riotId);
                getBridge()?.setToast("Riot ID copied");
              }}
            >
              Copy
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Requests */

export function RequestsView({ state }: { state: AppState }) {
  const sd = useStaticData();
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState(state.pendingRequests ?? []);

  useEffect(() => setRows(state.pendingRequests ?? []), [state.pendingRequests]);

  const refresh = async () => {
    const id = state.listing.id;
    if (!id) return;
    try {
      const fetched = await fetchListingRequests(id);
      const pending = fetched
        .filter((r) => r.status === "PENDING")
        .map((r) => ({
          joinRequestId: r.id,
          card: r.card,
          matchScore: r.matchScore ?? 0,
          offRole: r.offRole,
          roleSlot: r.roleSlot,
        }));
      getBridge()?.store.update({ pendingRequests: pending });
    } catch (e: any) {
      getBridge()?.setToast(e?.message ?? "Couldn't refresh requests");
    }
  };

  const decide = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      await (accept ? acceptJoin(id) : declineJoin(id));
      getBridge()?.store.update({
        pendingRequests: (getBridge()?.store.state.pendingRequests ?? []).filter(
          (r) => r.joinRequestId !== id
        ),
      });
      getBridge()?.setToast(accept ? "Accepted — sending invite" : "Request declined");
    } catch (e: any) {
      getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Action failed");
    } finally {
      setBusy(null);
    }
  };

  if (!rows.length) {
    return (
      <Card>
        <EmptyState
          title="No pending requests"
          hint="When someone asks to join your lobby, they'll show up here with their verified profile."
          action={state.listing.id ? <Button onClick={refresh}>Refresh</Button> : undefined}
        />
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex" }}>
        <Button size="sm" onClick={refresh} style={{ marginLeft: "auto" }}>
          Refresh
        </Button>
      </div>
      {rows.map((r) => {
        const a = r.card?.account;
        const snap = r.card?.snapshot;
        const champs = r.card?.champions ?? [];
        return (
          <Card key={r.joinRequestId} pad={17} interactive>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {a ? `${a.riotId}#${a.tagLine}` : "Player"}
                  </span>
                  <RankBadge tier={snap?.solo?.tier} division={snap?.solo?.division} lp={snap?.solo?.lp} size="sm" />
                  {r.offRole && <Tag color={c.warn}>Off-role</Tag>}
                  <Tag color={r.matchScore >= 75 ? c.win : c.primary}>
                    {r.matchScore}% compatible
                  </Tag>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 18,
                    marginTop: 10,
                    flexWrap: "wrap",
                    fontSize: 12,
                    color: c.textDim,
                  }}
                >
                  {r.roleSlot && (
                    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                      <RoleIcon role={r.roleSlot} size={13} /> wants {r.roleSlot}
                    </span>
                  )}
                  {snap?.primaryRole && <span>Main: {snap.primaryRole}</span>}
                  {snap?.formWr20 != null && <span>Form: {snap.formWr20}%</span>}
                  {snap?.gamesThisSeason != null && <span>{snap.gamesThisSeason} ranked games</span>}
                </div>

                {champs.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: c.textFaint }}>Plays:</span>
                    {champs.slice(0, 5).map((ch: any) => (
                      <Avatar key={ch.championId} url={championIcon(sd, ch.championId)} size={24} />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Button
                  variant="primary"
                  disabled={busy === r.joinRequestId}
                  onClick={() => decide(r.joinRequestId, true)}
                >
                  Accept
                </Button>
                <Button
                  variant="danger"
                  disabled={busy === r.joinRequestId}
                  onClick={() => decide(r.joinRequestId, false)}
                >
                  Decline
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- Session */

export function SessionView({
  state,
  bridge,
}: {
  state: AppState;
  bridge: LoblyBridge | null;
}) {
  const [body, setBody] = useState("");
  const session = state.session;

  if (!session) {
    return (
      <Card>
        <EmptyState
          title="No active session"
          hint="Once you and a teammate are confirmed in the same League lobby, your session chat opens here."
        />
      </Card>
    );
  }

  const send = () => {
    const text = body.trim();
    if (!text) return;
    bridge?.sendChat?.(session.id, text);
    setBody("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        pad={0}
        style={{
          display: "flex",
          flexDirection: "column",
          height: 480,
          overflow: "hidden",
          background:
            "radial-gradient(circle at 100% 0%, rgba(155,123,255,.1), transparent 35%), linear-gradient(145deg, rgba(15,25,40,.98), rgba(7,12,21,.98))",
        }}
      >
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${c.border}` }}>
          <SectionTitle right={<Tag color={c.win}>Active</Tag>}>
            Session chat · {session.memberAccountIds.length} members
          </SectionTitle>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          {!session.chat?.length && (
            <div style={{ color: c.textFaint, textAlign: "center", paddingTop: 40 }}>
              Say hello — chat stays open until 10 minutes after your last game.
            </div>
          )}
          {(session.chat ?? []).map((m: any, i: number) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 2 }}>
                {m.from?.riotId ?? m.fromAccountId ?? "Player"}
              </div>
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(66,215,255,.1), rgba(155,123,255,.08))",
                  border: `1px solid ${c.border}`,
                  borderRadius: `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
                  padding: "9px 13px",
                  display: "inline-block",
                  maxWidth: "80%",
                }}
              >
                {m.body}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 14,
            borderTop: `1px solid ${c.border}`,
            background: "rgba(4,8,14,.5)",
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message your teammates…"
            style={{
              flex: 1,
              background: c.surfaceAlt,
              border: `1px solid ${c.border}`,
              borderRadius: radius.md,
              color: c.text,
              padding: "9px 12px",
              fontSize: 13,
            }}
          />
          <Button variant="primary" onClick={send}>
            Send
          </Button>
        </div>
      </Card>

      {state.endorsePrompt && (
        <Card>
          <SectionTitle>Endorse your teammates</SectionTitle>
          {state.endorsePrompt.others.map((o) => (
            <div
              key={o.accountId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
              }}
            >
              <span style={{ flex: 1, fontWeight: 600 }}>
                {o.riotId}#{o.tagLine}
              </span>
              {(["GOOD_COMMS", "GOOD_TEAMMATE", "SKILLED"] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  onClick={async () => {
                    try {
                      await endorse(state.endorsePrompt!.sessionId, o.accountId, [kind]);
                      getBridge()?.setToast("Endorsement sent");
                    } catch (e: any) {
                      getBridge()?.setToast(e?.message ?? "Endorse failed");
                    }
                  }}
                >
                  {kind === "GOOD_COMMS" ? "Comms" : kind === "GOOD_TEAMMATE" ? "Teammate" : "Skilled"}
                </Button>
              ))}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
