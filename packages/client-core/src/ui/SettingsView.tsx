import { useEffect, useState, type CSSProperties } from "react";
import type { DiscordReveal, RiotAccountDto, UserPrefs, VoicePref } from "@lobly/shared-types";
import {
  deleteMyAccount,
  fetchMyProfiles,
  listBlocks,
  listRiotAccounts,
  signOut,
  unlinkRiotAccount,
  unblockAccount,
  updatePrefs,
} from "../api/session";
import { getBridge, type LoblyBridge } from "../shared/bridge";
import type { AppState } from "../state/store";
import { c, radius } from "./theme";
import { Button, Card, SectionTitle } from "./components";
import { DebugView } from "./DebugView";
import { LanguageMultiSelect } from "./LanguageSelect";

type Section = "match" | "app" | "accounts" | "privacy" | "diagnostics";

const VOICES: { id: VoicePref; label: string }[] = [
  { id: "LEAGUE_VOICE", label: "League voice" },
  { id: "DISCORD", label: "Discord" },
  { id: "NO_VOICE", label: "No voice" },
];

const REVEAL: { id: DiscordReveal; label: string }[] = [
  { id: "HIDDEN", label: "Hidden" },
  { id: "ACCEPTED", label: "After accept" },
  { id: "PUBLIC", label: "Public" },
];

export function SettingsView({
  state,
  bridge,
}: {
  state: AppState;
  bridge: LoblyBridge | null;
}) {
  const [section, setSection] = useState<Section>("match");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(
          [
            ["match", "Matchmaking"],
            ["app", "App"],
            ["accounts", "Accounts"],
            ["privacy", "Privacy"],
            ["diagnostics", "Diagnostics"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            style={{
              textAlign: "left",
              background: section === id ? c.primarySoft : "transparent",
              color: section === id ? c.primary : c.textDim,
              border: `1px solid ${section === id ? c.borderStrong : "transparent"}`,
              borderRadius: radius.md,
              padding: "8px 10px",
              cursor: "pointer",
              fontWeight: 650,
            }}
          >
            {label}
          </button>
        ))}
        <Button
          onClick={() => {
            const run = bridge?.signOut;
            if (run) void run();
            else void signOut();
          }}
          style={{ marginTop: 12 }}
        >
          Sign out
        </Button>
      </div>
      <div>
        {section === "match" && <MatchSection />}
        {section === "app" && <AppSection state={state} bridge={bridge} />}
        {section === "accounts" && <AccountsSection />}
        {section === "privacy" && <PrivacySection bridge={bridge} />}
        {section === "diagnostics" && <DebugView state={state} bridge={bridge} />}
      </div>
    </div>
  );
}

function MatchSection() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchMyProfiles()
      .then((cards) => setPrefs(cards.find((c) => c.prefs)?.prefs ?? blankPrefs()))
      .catch((e: any) => setError(e?.message ?? "Couldn't load prefs"));
  }, []);

  const save = async (patch: Partial<UserPrefs>) => {
    setSaving(true);
    setError(null);
    const next = { ...(prefs ?? blankPrefs()), ...patch };
    setPrefs(next);
    if (patch.autoAcceptLoblyInvites != null) {
      getBridge()?.store.update({ autoAcceptLoblyInvites: patch.autoAcceptLoblyInvites });
    }
    try {
      const saved = await updatePrefs(patch);
      setPrefs(saved);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <Card>
        <div style={{ color: c.textDim }}>{error ?? "Loading prefs…"}</div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Matchmaking</SectionTitle>
      {error && <div style={{ color: c.loss, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <Label>Languages</Label>
      <LanguageMultiSelect
        value={prefs.languages}
        disabled={saving}
        onChange={(languages) => void save({ languages })}
      />
      <Label>Voice</Label>
      <select
        value={prefs.voice}
        disabled={saving}
        onChange={(e) => void save({ voice: e.target.value as VoicePref })}
        style={field}
      >
        {VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <Label>Discord tag</Label>
      <input
        value={prefs.discordTag ?? ""}
        disabled={saving}
        placeholder="name"
        onChange={(e) => setPrefs({ ...prefs, discordTag: e.target.value })}
        onBlur={() => void save({ discordTag: prefs.discordTag?.trim() || null })}
        style={field}
      />
      <Label>Who can see Discord</Label>
      <select
        value={prefs.discordReveal}
        disabled={saving}
        onChange={(e) => void save({ discordReveal: e.target.value as DiscordReveal })}
        style={field}
      >
        {REVEAL.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: c.textDim }}>
        <input
          type="checkbox"
          checked={prefs.autoAcceptLoblyInvites}
          disabled={saving}
          onChange={(e) => void save({ autoAcceptLoblyInvites: e.target.checked })}
        />
        Auto-accept LOBLY invites
      </label>
    </Card>
  );
}

function AppSection({ state, bridge }: { state: AppState; bridge: LoblyBridge | null }) {
  const store = bridge?.store;
  const set = (patch: Partial<AppState>) => store?.update(patch);
  return (
    <Card>
      <SectionTitle>App</SectionTitle>
      <Check
        label="Open LOBLY when a game ends"
        checked={state.openOnGameEnd}
        onChange={(v) => set({ openOnGameEnd: v })}
      />
      <Check
        label="Desktop notifications"
        checked={state.notificationsEnabled}
        onChange={(v) => set({ notificationsEnabled: v })}
      />
      <Check
        label="Auto-accept queue pop"
        checked={state.autoAcceptQueue}
        onChange={(v) => set({ autoAcceptQueue: v })}
      />
      {bridge?.setOpenAtLogin && (
        <Check
          label="Start with Windows"
          checked={state.openAtLogin === true}
          onChange={(v) => {
            set({ openAtLogin: v });
            bridge.setOpenAtLogin?.(v);
          }}
        />
      )}
      <div style={{ color: c.textFaint, fontSize: 11, marginTop: 8 }}>
        Auto-accept queue pop waits 1.5s and clicks accept once per ready check. It stays off until you turn it on.
      </div>
    </Card>
  );
}

function AccountsSection() {
  const [rows, setRows] = useState<RiotAccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    void listRiotAccounts()
      .then(setRows)
      .catch((e: any) => setError(e?.message ?? "Couldn't load accounts"));
  };
  useEffect(load, []);

  return (
    <Card>
      <SectionTitle
        right={
          <Button
            size="sm"
            onClick={() =>
              void getBridge()
                ?.linkAnotherAccount?.()
                .then(load)
                .catch((e: any) => setError(e?.message ?? "Couldn't add account"))
            }
          >
            Add another
          </Button>
        }
      >
        Riot accounts
      </SectionTitle>
      {error && <div style={{ color: c.loss, fontSize: 12 }}>{error}</div>}
      {(rows ?? []).map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            borderTop: `1px solid ${c.border}`,
          }}
        >
          <span style={{ flex: 1 }}>
            {a.riotId}
            <span style={{ color: c.textFaint }}>#{a.tagLine}</span>
          </span>
          <Button
            size="sm"
            disabled={busy === a.id}
            onClick={() => {
              if (!window.confirm(`Unlink ${a.riotId}#${a.tagLine}?`)) return;
              setBusy(a.id);
              void unlinkRiotAccount(a.id)
                .then(load)
                .catch((e: any) => setError(e?.message ?? "Couldn't unlink"))
                .finally(() => setBusy(null));
            }}
          >
            Unlink
          </Button>
        </div>
      ))}
      {rows && rows.length === 0 && (
        <div style={{ color: c.textFaint, fontSize: 12 }}>No linked accounts yet.</div>
      )}
    </Card>
  );
}

function PrivacySection({ bridge }: { bridge: LoblyBridge | null }) {
  const [blocks, setBlocks] = useState<{ accountId: string; createdAt: string }[]>([]);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void listBlocks()
      .then(setBlocks)
      .catch(() => undefined);
  };
  useEffect(load, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card>
        <SectionTitle>Blocked players</SectionTitle>
        {blocks.length === 0 && <div style={{ color: c.textFaint, fontSize: 12 }}>No blocks.</div>}
        {blocks.map((b) => (
          <div key={b.accountId} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}>
            <span style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}>{b.accountId}</span>
            <Button
              size="sm"
              onClick={() =>
                void unblockAccount(b.accountId)
                  .then(load)
                  .catch((e: any) => setError(e?.message ?? "Couldn't unblock"))
              }
            >
              Unblock
            </Button>
          </div>
        ))}
      </Card>
      <Card>
        <SectionTitle>Delete my LOBLY account</SectionTitle>
        <p style={{ color: c.textDim, fontSize: 12, marginTop: 0 }}>
          Type DELETE to confirm. This signs you out.
        </p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} style={field} />
        {error && <div style={{ color: c.loss, fontSize: 12, marginTop: 6 }}>{error}</div>}
        <div style={{ marginTop: 8 }}>
          <Button
            variant="danger"
            disabled={confirm !== "DELETE"}
            onClick={() => {
              void deleteMyAccount()
                .then(() => {
                  const run = bridge?.signOut;
                  if (run) return run();
                  return signOut();
                })
                .catch((e: any) => setError(e?.message ?? "Couldn't delete account"));
            }}
          >
            Delete account
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", color: c.text }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div style={{ margin: "12px 0 6px", fontSize: 11, color: c.textFaint, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function blankPrefs(): UserPrefs {
  return {
    languages: [],
    voice: "LEAGUE_VOICE",
    vibeTags: [],
    discordTag: null,
    discordReveal: "HIDDEN",
    autoAcceptLoblyInvites: false,
  };
}

const field: CSSProperties = {
  width: "100%",
  background: c.surfaceAlt,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  color: c.text,
  padding: "8px 10px",
  fontSize: 13,
};
