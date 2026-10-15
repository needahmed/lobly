import { useState } from "react";
import type { AppState } from "../state/store";
import type { LoblyBridge } from "../shared/bridge";
import { redactPuuid } from "../shared/log";
import { c, radius, font } from "./theme";
import { Button, Card, SectionTitle, Tag } from "./components";

export function DebugView({
  state,
  bridge,
}: {
  state: AppState;
  bridge: LoblyBridge | null;
}) {
  const [inviteId, setInviteId] = useState("");
  const [out, setOut] = useState("");

  const facts: [string, string][] = [
    ["League client", state.lcu.connected ? `connected :${state.lcu.port}` : "not connected"],
    ["Gameflow phase", state.gameflowPhase],
    ["LOBLY server", state.sync.connected ? "connected" : "disconnected"],
    ["Riot ID", state.summoner ? `${state.summoner.gameName}#${state.summoner.tagLine}` : "—"],
    ["Platform", state.summoner?.platform ?? "—"],
    ["LCU puuid", redactPuuid(state.summoner?.puuid) || "—"],
    ["summonerId", String(state.summoner?.summonerId ?? "—")],
    ["Linked account", state.riotAccountId ?? "not linked"],
    ["Listing", `${state.listing.status}${state.listing.id ? ` (${state.listing.id.slice(0, 8)})` : ""}`],
    ["GEP features", state.gep.active ? state.gep.features.join(", ") || "active" : "inactive"],
    ["LCU WebSocket", state.wsAvailable ? "connected" : "not connected"],
    [
      "Party",
      state.party?.members.length
        ? state.party.members
            .map((m) => {
              const role = m.champSelect?.assignedRole ?? m.roles[0] ?? "FILL";
              return `${m.riotId ?? `#${m.summonerId}`}${m.isLocal ? " (you)" : ""} · ${role}`;
            })
            .join(", ")
        : "—",
    ],
    [
      "Open roles",
      state.party?.positional ? state.party.openRoles.join(", ") || "none" : "n/a",
    ],
    ["Game id", state.party?.gameId != null ? String(state.party.gameId) : "—"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        pad={20}
        style={{
          background:
            "radial-gradient(circle at 88% 0%, rgba(66,215,255,.11), transparent 34%), linear-gradient(145deg, rgba(15,26,42,.98), rgba(7,12,21,.98))",
        }}
      >
        <SectionTitle>Connection status</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 8,
            fontSize: 12,
          }}
        >
          {facts.map(([k, v]) => (
            <div
              key={k}
              style={{
                padding: "10px 12px",
                background: "rgba(255,255,255,.025)",
                border: `1px solid ${c.border}`,
                borderRadius: radius.md,
                minWidth: 0,
              }}
            >
              <div style={{ color: c.textFaint, fontSize: 9, textTransform: "uppercase", letterSpacing: .8 }}>
                {k}
              </div>
              <div
                className="lobly-truncate"
                style={{ fontFamily: font.mono, marginTop: 4, color: c.text }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ background: "rgba(9,15,25,.88)" }}>
        <SectionTitle>State machine</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" onClick={() => bridge?.dispatch({ type: "JOIN_ACCEPTED" })}>
            Simulate JOIN_ACCEPTED
          </Button>
          <Button size="sm" onClick={() => bridge?.dispatch({ type: "MEMBER_ARRIVED" })}>
            Simulate MEMBER_ARRIVED
          </Button>
          <Button size="sm" onClick={() => bridge?.dispatch({ type: "SLOT_REOPENED" })}>
            Simulate SLOT_REOPENED
          </Button>
          <Button size="sm" onClick={() => bridge?.dispatch({ type: "EXPIRED" })}>
            Simulate EXPIRED
          </Button>
        </div>
      </Card>

      {bridge?.spike && (
        <Card style={{ background: "rgba(9,15,25,.88)" }}>
          <SectionTitle>LCU lab</SectionTitle>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  setOut(await bridge.spike!.restGet());
                } catch (e: any) {
                  setOut(String(e?.message ?? e));
                }
              }}
            >
              GET current-summoner
            </Button>
            <input
              value={inviteId}
              onChange={(e) => setInviteId(e.target.value)}
              placeholder="toSummonerId"
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: radius.md,
                color: c.text,
                padding: "6px 10px",
                fontSize: 12,
                width: 180,
                fontFamily: font.mono,
              }}
            />
            <Button
              size="sm"
              onClick={async () => {
                try {
                  setOut(await bridge.spike!.restPost(Number(inviteId)));
                } catch (e: any) {
                  setOut(String(e?.message ?? e));
                }
              }}
            >
              Send test invite
            </Button>
          </div>
          {out && (
            <pre
              style={{
                marginTop: 12,
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: radius.md,
                padding: 12,
                fontSize: 11,
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                color: c.textDim,
              }}
            >
              {out}
            </pre>
          )}
        </Card>
      )}

      <Card style={{ background: "rgba(7,12,20,.92)" }}>
        <SectionTitle right={<Tag color={c.textFaint}>{state.log.length} lines</Tag>}>
          Event log
        </SectionTitle>
        <div
          style={{
            background: c.bgDeep,
            border: `1px solid ${c.border}`,
            borderRadius: radius.md,
            padding: 10,
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: font.mono,
            fontSize: 11,
            lineHeight: 1.7,
          }}
        >
          {state.log.length === 0 && <span style={{ color: c.textFaint }}>No events yet.</span>}
          {state.log
            .slice(-80)
            .reverse()
            .map((line, i) => {
              const space = line.indexOf(" ");
              const ts = line.slice(0, space);
              const msg = line.slice(space + 1);
              return (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: c.textFaint, flexShrink: 0 }}>
                    {ts.slice(11, 19)}
                  </span>
                  <span style={{ color: c.textDim }}>{msg}</span>
                </div>
              );
            })}
        </div>
      </Card>
    </div>
  );
}
