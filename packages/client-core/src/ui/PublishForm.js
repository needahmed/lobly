import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { ALL_ROLES, DIVISION_ORDER, TIER_ORDER, formatSlotRoles, } from "@lobly/shared-types";
import { applyRankPreset, capabilitySignature, clampSlotCount, reconcileDraftToCapability, resizeSlotRoles, } from "../state/publishDraft";
import { setPublishDraft } from "../state/listingMachine";
import { LanguageMultiSelect } from "./LanguageSelect";
import { c, radius, ROLE_LABEL } from "./theme";
import { Button, RoleIcon, SectionTitle, Tag } from "./components";
const inputStyle = {
    background: c.surfaceAlt,
    border: `1px solid ${c.border}`,
    borderRadius: radius.md,
    color: c.text,
    padding: "10px 12px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
};
const labelStyle = {
    fontSize: 10,
    fontWeight: 750,
    letterSpacing: 0.85,
    textTransform: "uppercase",
    color: c.textFaint,
    marginBottom: 6,
    display: "block",
};
function Field({ label, children, }) {
    return (_jsxs("div", { style: { marginBottom: 14 }, children: [_jsx("label", { style: labelStyle, children: label }), children] }));
}
function RoleChip({ role, active, onClick, }) {
    return (_jsxs("button", { type: "button", onClick: onClick, style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "7px 10px",
            borderRadius: radius.pill,
            border: `1px solid ${active ? c.primary : c.border}`,
            background: active
                ? "linear-gradient(135deg, rgba(66,215,255,.15), rgba(155,123,255,.11))"
                : c.surfaceAlt,
            color: active ? c.text : c.textDim,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
        }, children: [role !== "ANY" && _jsx(RoleIcon, { role: role, size: 12 }), role === "ANY" ? "Any" : ROLE_LABEL[role] ?? role] }));
}
function SlotRolePicker({ index, roles, onChange, }) {
    const isAny = roles.length === 0;
    const primary = roles[0] ?? null;
    const secondary = roles[1] ?? null;
    return (_jsxs("div", { style: {
            background: "rgba(16,25,39,.72)",
            border: `1px solid ${primary ? c.borderStrong : c.border}`,
            borderRadius: radius.lg,
            padding: 14,
            marginBottom: 8,
        }, children: [_jsxs("div", { style: {
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    alignItems: "center",
                }, children: [_jsxs("span", { style: { fontSize: 12, fontWeight: 700 }, children: ["Slot ", index + 1] }), _jsx(Tag, { color: c.textDim, children: formatSlotRoles(roles) })] }), _jsx("div", { style: { fontSize: 11, color: c.textFaint, marginBottom: 6 }, children: "Looking for (primary / secondary)" }), _jsxs("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: [_jsx(RoleChip, { role: "ANY", active: isAny, onClick: () => onChange([]) }), ALL_ROLES.map((r) => (_jsx(RoleChip, { role: r, active: primary === r, onClick: () => {
                            if (primary === r)
                                onChange(secondary ? [secondary] : []);
                            else if (secondary === r)
                                onChange([r]);
                            else
                                onChange(secondary ? [r, secondary] : [r]);
                        } }, r)))] }), !isAny && (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: 11, color: c.textFaint, marginBottom: 6 }, children: "Also OK (secondary)" }), _jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: ALL_ROLES.filter((r) => r !== primary).map((r) => (_jsx(RoleChip, { role: r, active: secondary === r, onClick: () => {
                                if (secondary === r)
                                    onChange(primary ? [primary] : []);
                                else
                                    onChange(primary ? [primary, r] : [r]);
                            } }, r))) })] }))] }));
}
export function PublishForm({ initialDraft, cap, live, creatorTier, creatorDivision, onPublish, onUnpublish, onSaveEdit, onQueueAgain, canPublishOk, publishReason, status, editing, }) {
    // The form owns the draft. Host windows (Electron renderer, Overwolf desktop)
    // run in a different JS realm than the process that owns appStore, so writing
    // every keystroke across the bridge and reading it back is both lossy and
    // racy against state pushes from the main process. We only hand the finished
    // draft over on Publish / Save.
    const [draft, setDraft] = useState(initialDraft);
    const seededFor = useRef(capabilitySignature(cap));
    useEffect(() => {
        const sig = capabilitySignature(cap);
        if (sig === seededFor.current)
            return;
        seededFor.current = sig;
        setDraft((cur) => cur.queueId === cap.queueId
            ? reconcileDraftToCapability(cur, cap)
            : initialDraft);
    }, [cap, initialDraft]);
    // Mirror into the shared store so the machine can publish without the form.
    useEffect(() => {
        setPublishDraft(draft);
    }, [draft]);
    const maxSlots = Math.max(1, Math.min(4, Math.max(1, cap.freeSeats)));
    const patch = (p) => setDraft((cur) => ({ ...cur, ...p }));
    const setSlotCount = (n) => {
        const count = clampSlotCount(cap, n);
        setDraft((cur) => ({
            ...cur,
            slotCount: count,
            slotRoles: resizeSlotRoles(cur.slotRoles, count),
        }));
    };
    const setPreset = (preset) => {
        setDraft((cur) => ({
            ...cur,
            rankPreset: preset,
            filters: preset === "custom"
                ? cur.filters
                : applyRankPreset(preset, creatorTier, creatorDivision, cap.duoRules),
        }));
    };
    return (_jsxs("div", { children: [_jsx(SectionTitle, { right: _jsxs(Tag, { color: c.accent, children: [cap.freeSeats, " free seat", cap.freeSeats === 1 ? "" : "s"] }), children: editing ? "Edit listing" : "What are you looking for?" }), _jsx("div", { style: {
                    margin: "-4px 0 18px",
                    color: c.textDim,
                    fontSize: 12,
                    lineHeight: 1.55,
                    maxWidth: 680,
                }, children: "LOBLY uses these signals to surface your squad to compatible, verified players. You stay in control of every seat." }), _jsx(Field, { label: "Title", children: _jsx("input", { style: inputStyle, value: draft.title, maxLength: 80, onChange: (e) => patch({ title: e.target.value }), disabled: live && !editing }) }), _jsx(Field, { label: "Note (optional)", children: _jsx("textarea", { style: { ...inputStyle, minHeight: 56, resize: "vertical" }, value: draft.description, maxLength: 280, onChange: (e) => patch({ description: e.target.value }), disabled: live && !editing, placeholder: "e.g. chill vibes, mic preferred\u2026" }) }), _jsx(Field, { label: cap.positional
                    ? `Players needed (1–${maxSlots})`
                    : `Open slots (1–${maxSlots})`, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx(Button, { size: "sm", disabled: (live && !editing) || draft.slotCount <= 1, onClick: () => setSlotCount(draft.slotCount - 1), children: "\u2212" }), _jsx("span", { style: { fontWeight: 700, minWidth: 24, textAlign: "center" }, children: draft.slotCount }), _jsx(Button, { size: "sm", disabled: (live && !editing) || draft.slotCount >= maxSlots, onClick: () => setSlotCount(draft.slotCount + 1), children: "+" }), !cap.positional && (_jsx("span", { style: { fontSize: 12, color: c.textDim }, children: "Any role fills these seats" }))] }) }), cap.positional && (_jsx(Field, { label: "Roles per slot", children: Array.from({ length: draft.slotCount }).map((_, i) => (_jsx(SlotRolePicker, { index: i, roles: draft.slotRoles[i] ?? [], onChange: (roles) => {
                        const next = resizeSlotRoles(draft.slotRoles, draft.slotCount);
                        next[i] = roles;
                        patch({ slotRoles: next });
                    } }, i))) })), _jsxs(Field, { label: "Rank range", children: [_jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: [
                            ["any", "Any rank"],
                            ["near", "My rank ±1"],
                            ["above", "My rank+"],
                            ["custom", "Custom"],
                        ].map(([key, label]) => (_jsx(Button, { size: "sm", variant: draft.rankPreset === key ? "primary" : "ghost", disabled: live && !editing, onClick: () => setPreset(key), children: label }, key))) }), cap.duoRules && (_jsx("div", { style: { fontSize: 11, color: c.warn, marginBottom: 8 }, children: "Solo/Duo: Riot rank-spread rules still apply (Master+ can't duo)." })), draft.rankPreset === "custom" && (_jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: [_jsxs("select", { style: inputStyle, value: draft.filters.minTier ?? "", disabled: live && !editing, onChange: (e) => patch({
                                    filters: {
                                        ...draft.filters,
                                        minTier: e.target.value || undefined,
                                        minDivision: draft.filters.minDivision ?? "IV",
                                        allowUnranked: false,
                                    },
                                }), children: [_jsx("option", { value: "", children: "Min tier" }), TIER_ORDER.map((t) => (_jsx("option", { value: t, children: t }, t)))] }), _jsx("select", { style: inputStyle, value: draft.filters.minDivision ?? "IV", disabled: live && !editing, onChange: (e) => patch({
                                    filters: { ...draft.filters, minDivision: e.target.value },
                                }), children: DIVISION_ORDER.map((d) => (_jsx("option", { value: d, children: d }, d))) }), _jsxs("select", { style: inputStyle, value: draft.filters.maxTier ?? "", disabled: live && !editing, onChange: (e) => patch({
                                    filters: {
                                        ...draft.filters,
                                        maxTier: e.target.value || undefined,
                                        maxDivision: draft.filters.maxDivision ?? "I",
                                        allowUnranked: false,
                                    },
                                }), children: [_jsx("option", { value: "", children: "Max tier" }), TIER_ORDER.map((t) => (_jsx("option", { value: t, children: t }, t)))] }), _jsx("select", { style: inputStyle, value: draft.filters.maxDivision ?? "I", disabled: live && !editing, onChange: (e) => patch({
                                    filters: { ...draft.filters, maxDivision: e.target.value },
                                }), children: DIVISION_ORDER.map((d) => (_jsx("option", { value: d, children: d }, d))) })] }))] }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10,
                    marginBottom: 14,
                }, children: [_jsx(Field, { label: "Duration", children: _jsxs("select", { style: inputStyle, value: draft.durationMin, disabled: live && !editing, onChange: (e) => patch({ durationMin: Number(e.target.value) }), children: [_jsx("option", { value: 15, children: "15 min" }), _jsx("option", { value: 30, children: "30 min" }), _jsx("option", { value: 60, children: "60 min" })] }) }), _jsx(Field, { label: "Language", children: _jsx(LanguageMultiSelect, { value: draft.languages, disabled: live && !editing, onChange: (languages) => patch({ languages }) }) }), _jsx(Field, { label: "Voice", children: _jsxs("label", { style: {
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 13,
                                color: c.textDim,
                                marginTop: 6,
                            }, children: [_jsx("input", { type: "checkbox", checked: draft.voiceRequired, disabled: live && !editing, onChange: (e) => patch({ voiceRequired: e.target.checked }) }), "Required"] }) })] }), _jsxs("div", { style: {
                    background: "radial-gradient(circle at 100% 0%, rgba(155,123,255,.12), transparent 40%), linear-gradient(135deg, rgba(66,215,255,.07), rgba(10,17,28,.8))",
                    border: `1px solid ${c.borderStrong}`,
                    borderRadius: radius.lg,
                    padding: 15,
                    marginBottom: 16,
                    fontSize: 12,
                    color: c.textDim,
                }, children: [_jsx("div", { style: { fontSize: 9, fontWeight: 800, color: c.primary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }, children: "Live board preview" }), _jsx("div", { style: { fontWeight: 760, fontSize: 15, color: c.text, marginBottom: 5 }, children: draft.title || "Untitled lobby" }), "Looking for ", draft.slotCount, " \u00B7", " ", cap.positional
                        ? draft.slotRoles
                            .slice(0, draft.slotCount)
                            .map((r) => formatSlotRoles(r))
                            .join(", ")
                        : "any role", draft.filters.minTier || draft.filters.maxTier
                        ? ` · ${draft.filters.minTier ?? "…"}–${draft.filters.maxTier ?? "…"}`
                        : " · any rank"] }), publishReason && !canPublishOk && (_jsx("div", { style: {
                    background: c.lossSoft,
                    border: `1px solid ${c.loss}33`,
                    color: c.loss,
                    borderRadius: radius.md,
                    padding: "9px 12px",
                    fontSize: 12,
                    marginBottom: 12,
                }, children: publishReason })), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [!live && (_jsx(Button, { variant: "primary", disabled: !canPublishOk, onClick: () => onPublish(draft), children: "Publish lobby" })), live && editing && onSaveEdit && (_jsx(Button, { variant: "primary", onClick: () => onSaveEdit(draft), children: "Save changes" })), _jsx(Button, { disabled: status === "DRAFT" || status === "DELISTED", onClick: onUnpublish, children: "Unpublish" }), (status === "PAUSED" || status === "POST_SESSION") && onQueueAgain && (_jsx(Button, { onClick: onQueueAgain, children: "Queue again" }))] })] }));
}
