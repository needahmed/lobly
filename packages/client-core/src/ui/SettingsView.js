import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { deleteMyAccount, fetchMyProfiles, listBlocks, listRiotAccounts, signOut, unlinkRiotAccount, unblockAccount, updatePrefs, } from "../api/session";
import { getBridge } from "../shared/bridge";
import { c, radius } from "./theme";
import { Button, Card, SectionTitle } from "./components";
import { DebugView } from "./DebugView";
import { LanguageMultiSelect } from "./LanguageSelect";
const VOICES = [
    { id: "LEAGUE_VOICE", label: "League voice" },
    { id: "DISCORD", label: "Discord" },
    { id: "NO_VOICE", label: "No voice" },
];
const REVEAL = [
    { id: "HIDDEN", label: "Hidden" },
    { id: "ACCEPTED", label: "After accept" },
    { id: "PUBLIC", label: "Public" },
];
export function SettingsView({ state, bridge, }) {
    const [section, setSection] = useState("match");
    return (_jsxs("div", { style: { display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }, children: [_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [[
                        ["match", "Matchmaking"],
                        ["app", "App"],
                        ["accounts", "Accounts"],
                        ["privacy", "Privacy"],
                        ["diagnostics", "Diagnostics"],
                    ].map(([id, label]) => (_jsx("button", { type: "button", onClick: () => setSection(id), style: {
                            textAlign: "left",
                            background: section === id ? c.primarySoft : "transparent",
                            color: section === id ? c.primary : c.textDim,
                            border: `1px solid ${section === id ? c.borderStrong : "transparent"}`,
                            borderRadius: radius.md,
                            padding: "8px 10px",
                            cursor: "pointer",
                            fontWeight: 650,
                        }, children: label }, id))), _jsx(Button, { onClick: () => {
                            const run = bridge?.signOut;
                            if (run)
                                void run();
                            else
                                void signOut();
                        }, style: { marginTop: 12 }, children: "Sign out" })] }), _jsxs("div", { children: [section === "match" && _jsx(MatchSection, {}), section === "app" && _jsx(AppSection, { state: state, bridge: bridge }), section === "accounts" && _jsx(AccountsSection, {}), section === "privacy" && _jsx(PrivacySection, { bridge: bridge }), section === "diagnostics" && _jsx(DebugView, { state: state, bridge: bridge })] })] }));
}
function MatchSection() {
    const [prefs, setPrefs] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        void fetchMyProfiles()
            .then((cards) => setPrefs(cards.find((c) => c.prefs)?.prefs ?? blankPrefs()))
            .catch((e) => setError(e?.message ?? "Couldn't load prefs"));
    }, []);
    const save = async (patch) => {
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
        }
        catch (e) {
            setError(e?.message ?? "Couldn't save");
        }
        finally {
            setSaving(false);
        }
    };
    if (!prefs) {
        return (_jsx(Card, { children: _jsx("div", { style: { color: c.textDim }, children: error ?? "Loading prefs…" }) }));
    }
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Matchmaking" }), error && _jsx("div", { style: { color: c.loss, fontSize: 12, marginBottom: 8 }, children: error }), _jsx(Label, { children: "Languages" }), _jsx(LanguageMultiSelect, { value: prefs.languages, disabled: saving, onChange: (languages) => void save({ languages }) }), _jsx(Label, { children: "Voice" }), _jsx("select", { value: prefs.voice, disabled: saving, onChange: (e) => void save({ voice: e.target.value }), style: field, children: VOICES.map((v) => (_jsx("option", { value: v.id, children: v.label }, v.id))) }), _jsx(Label, { children: "Discord tag" }), _jsx("input", { value: prefs.discordTag ?? "", disabled: saving, placeholder: "name", onChange: (e) => setPrefs({ ...prefs, discordTag: e.target.value }), onBlur: () => void save({ discordTag: prefs.discordTag?.trim() || null }), style: field }), _jsx(Label, { children: "Who can see Discord" }), _jsx("select", { value: prefs.discordReveal, disabled: saving, onChange: (e) => void save({ discordReveal: e.target.value }), style: field, children: REVEAL.map((v) => (_jsx("option", { value: v.id, children: v.label }, v.id))) }), _jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 12, color: c.textDim }, children: [_jsx("input", { type: "checkbox", checked: prefs.autoAcceptLoblyInvites, disabled: saving, onChange: (e) => void save({ autoAcceptLoblyInvites: e.target.checked }) }), "Auto-accept LOBLY invites"] })] }));
}
function AppSection({ state, bridge }) {
    const store = bridge?.store;
    const set = (patch) => store?.update(patch);
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "App" }), _jsx(Check, { label: "Open LOBLY when a game ends", checked: state.openOnGameEnd, onChange: (v) => set({ openOnGameEnd: v }) }), _jsx(Check, { label: "Desktop notifications", checked: state.notificationsEnabled, onChange: (v) => set({ notificationsEnabled: v }) }), _jsx(Check, { label: "Auto-accept queue pop", checked: state.autoAcceptQueue, onChange: (v) => set({ autoAcceptQueue: v }) }), bridge?.setOpenAtLogin && (_jsx(Check, { label: "Start with Windows", checked: state.openAtLogin === true, onChange: (v) => {
                    set({ openAtLogin: v });
                    bridge.setOpenAtLogin?.(v);
                } })), _jsx("div", { style: { color: c.textFaint, fontSize: 11, marginTop: 8 }, children: "Auto-accept queue pop waits 1.5s and clicks accept once per ready check. It stays off until you turn it on." })] }));
}
function AccountsSection() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const load = () => {
        void listRiotAccounts()
            .then(setRows)
            .catch((e) => setError(e?.message ?? "Couldn't load accounts"));
    };
    useEffect(load, []);
    return (_jsxs(Card, { children: [_jsx(SectionTitle, { right: _jsx(Button, { size: "sm", onClick: () => void getBridge()
                        ?.linkAnotherAccount?.()
                        .then(load)
                        .catch((e) => setError(e?.message ?? "Couldn't add account")), children: "Add another" }), children: "Riot accounts" }), error && _jsx("div", { style: { color: c.loss, fontSize: 12 }, children: error }), (rows ?? []).map((a) => (_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 0",
                    borderTop: `1px solid ${c.border}`,
                }, children: [_jsxs("span", { style: { flex: 1 }, children: [a.riotId, _jsxs("span", { style: { color: c.textFaint }, children: ["#", a.tagLine] })] }), _jsx(Button, { size: "sm", disabled: busy === a.id, onClick: () => {
                            if (!window.confirm(`Unlink ${a.riotId}#${a.tagLine}?`))
                                return;
                            setBusy(a.id);
                            void unlinkRiotAccount(a.id)
                                .then(load)
                                .catch((e) => setError(e?.message ?? "Couldn't unlink"))
                                .finally(() => setBusy(null));
                        }, children: "Unlink" })] }, a.id))), rows && rows.length === 0 && (_jsx("div", { style: { color: c.textFaint, fontSize: 12 }, children: "No linked accounts yet." }))] }));
}
function PrivacySection({ bridge }) {
    const [blocks, setBlocks] = useState([]);
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState(null);
    const load = () => {
        void listBlocks()
            .then(setBlocks)
            .catch(() => undefined);
    };
    useEffect(load, []);
    return (_jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Blocked players" }), blocks.length === 0 && _jsx("div", { style: { color: c.textFaint, fontSize: 12 }, children: "No blocks." }), blocks.map((b) => (_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }, children: [_jsx("span", { style: { flex: 1, fontFamily: "monospace", fontSize: 12 }, children: b.accountId }), _jsx(Button, { size: "sm", onClick: () => void unblockAccount(b.accountId)
                                    .then(load)
                                    .catch((e) => setError(e?.message ?? "Couldn't unblock")), children: "Unblock" })] }, b.accountId)))] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Delete my LOBLY account" }), _jsx("p", { style: { color: c.textDim, fontSize: 12, marginTop: 0 }, children: "Type DELETE to confirm. This signs you out." }), _jsx("input", { value: confirm, onChange: (e) => setConfirm(e.target.value), style: field }), error && _jsx("div", { style: { color: c.loss, fontSize: 12, marginTop: 6 }, children: error }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(Button, { variant: "danger", disabled: confirm !== "DELETE", onClick: () => {
                                void deleteMyAccount()
                                    .then(() => {
                                    const run = bridge?.signOut;
                                    if (run)
                                        return run();
                                    return signOut();
                                })
                                    .catch((e) => setError(e?.message ?? "Couldn't delete account"));
                            }, children: "Delete account" }) })] })] }));
}
function Check({ label, checked, onChange, }) {
    return (_jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", margin: "8px 0", color: c.text }, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked) }), label] }));
}
function Label({ children }) {
    return (_jsx("div", { style: { margin: "12px 0 6px", fontSize: 11, color: c.textFaint, fontWeight: 700 }, children: children }));
}
function blankPrefs() {
    return {
        languages: [],
        voice: "LEAGUE_VOICE",
        vibeTags: [],
        discordTag: null,
        discordReveal: "HIDDEN",
        autoAcceptLoblyInvites: false,
    };
}
const field = {
    width: "100%",
    background: c.surfaceAlt,
    border: `1px solid ${c.border}`,
    borderRadius: radius.md,
    color: c.text,
    padding: "8px 10px",
    fontSize: 13,
};
