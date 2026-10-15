import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { blockAccount, decideJoin, reportAccount, } from "../api/session";
import { getBridge } from "../shared/bridge";
import { c, radius } from "./theme";
import { Button } from "./components";
const REASONS = [
    { id: "HARASSMENT", label: "Harassment" },
    { id: "SLURS", label: "Slurs" },
    { id: "BAIT_JOIN", label: "Bait join" },
    { id: "OTHER", label: "Other" },
];
export function PlayerMenu({ accountId, pendingJoinRequestId, listingId, sessionId, }) {
    const [open, setOpen] = useState(false);
    const [reporting, setReporting] = useState(false);
    const [reason, setReason] = useState("HARASSMENT");
    const [detail, setDetail] = useState("");
    const [busy, setBusy] = useState(false);
    const block = async () => {
        if (!window.confirm("Block this player? Pending requests from them will be declined."))
            return;
        setBusy(true);
        try {
            await blockAccount(accountId);
            if (pendingJoinRequestId) {
                try {
                    await decideJoin(pendingJoinRequestId, false);
                }
                catch {
                    /* already decided */
                }
            }
            const store = getBridge()?.store;
            if (store && (listingId || accountId)) {
                const board = (store.state.board ?? []).filter((row) => {
                    if (listingId && row?.listing?.id === listingId)
                        return false;
                    if (row?.listing?.creatorAccountId === accountId)
                        return false;
                    return true;
                });
                store.update({ board });
            }
            getBridge()?.setToast("Player blocked");
            setOpen(false);
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Couldn't block");
        }
        finally {
            setBusy(false);
        }
    };
    const report = async () => {
        setBusy(true);
        try {
            await reportAccount({
                accountId,
                reason,
                detail: detail.trim() || undefined,
                sessionId,
            });
            getBridge()?.setToast("Report sent");
            setReporting(false);
            setOpen(false);
            setDetail("");
        }
        catch (e) {
            getBridge()?.setToast(e?.body?.message ?? e?.message ?? "Couldn't report");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { style: { position: "relative" }, children: [_jsx("button", { type: "button", title: "More", onClick: () => setOpen((v) => !v), style: {
                    background: "transparent",
                    border: `1px solid ${c.border}`,
                    color: c.textDim,
                    borderRadius: radius.md,
                    width: 32,
                    height: 32,
                    cursor: "pointer",
                }, children: "\u22EF" }), open && (_jsxs("div", { style: {
                    position: "absolute",
                    right: 0,
                    top: 36,
                    zIndex: 20,
                    minWidth: 160,
                    background: c.raised,
                    border: `1px solid ${c.borderStrong}`,
                    borderRadius: radius.md,
                    padding: 6,
                    display: "grid",
                    gap: 4,
                }, children: [_jsx(Button, { size: "sm", disabled: busy, onClick: () => void block(), children: "Block" }), _jsx(Button, { size: "sm", disabled: busy, onClick: () => setReporting(true), children: "Report" })] })), reporting && (_jsx("div", { style: {
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,.55)",
                    zIndex: 80,
                    display: "grid",
                    placeItems: "center",
                }, onClick: () => setReporting(false), children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: {
                        width: 360,
                        background: c.surface,
                        border: `1px solid ${c.border}`,
                        borderRadius: radius.lg,
                        padding: 16,
                    }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 10 }, children: "Report player" }), _jsx("select", { value: reason, onChange: (e) => setReason(e.target.value), style: {
                                width: "100%",
                                marginBottom: 8,
                                background: c.surfaceAlt,
                                color: c.text,
                                border: `1px solid ${c.border}`,
                                borderRadius: radius.md,
                                padding: 8,
                            }, children: REASONS.map((r) => (_jsx("option", { value: r.id, children: r.label }, r.id))) }), _jsx("textarea", { value: detail, maxLength: 500, onChange: (e) => setDetail(e.target.value.slice(0, 500)), placeholder: "What happened? (optional)", style: {
                                width: "100%",
                                minHeight: 80,
                                background: c.surfaceAlt,
                                color: c.text,
                                border: `1px solid ${c.border}`,
                                borderRadius: radius.md,
                                padding: 8,
                                resize: "vertical",
                            } }), _jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }, children: [_jsx(Button, { onClick: () => setReporting(false), children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: busy, onClick: () => void report(), children: "Send report" })] })] }) }))] }));
}
