import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { ensureSession } from "../api/session";
import { getHostAdapter } from "../hostAdapter";
import { getBridge } from "../shared/bridge";
import { c, radius, font } from "./theme";
import { BrandMark, Button, Card } from "./components";
export function SignInGate({ state }) {
    const dev = state.devAuthEnabled ||
        (() => {
            try {
                return getHostAdapter().isDevAuthEnabled?.() === true;
            }
            catch {
                return false;
            }
        })();
    const [email, setEmail] = useState("dev@lobly.local");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const leagueReady = state.lcu.connected && !!state.summoner;
    const progress = state.signInPhase;
    const verify = async () => {
        setError(null);
        setBusy(true);
        try {
            const run = getBridge()?.riotSignIn;
            if (!run)
                throw new Error("League sign-in is not available in this window");
            await run();
        }
        catch (e) {
            setError(e?.body?.message ?? e?.message ?? "Verification failed");
        }
        finally {
            setBusy(false);
        }
    };
    const devLogin = async () => {
        setError(null);
        setBusy(true);
        try {
            const run = getBridge()?.devSignIn;
            if (run)
                await run(email, password);
            else
                await ensureSession(email, password);
        }
        catch (e) {
            setError(e?.body?.message ?? e?.message ?? "Login failed");
        }
        finally {
            setBusy(false);
        }
    };
    const headline = !state.lcu.connected
        ? "Open League client"
        : progress
            ? progress
            : state.accountMismatch
                ? "This League account isn't linked"
                : "Verify with League client";
    return (_jsx("div", { style: {
            flex: 1,
            display: "grid",
            placeItems: "center",
            padding: 28,
        }, children: _jsxs(Card, { style: { width: "min(440px, 100%)", textAlign: "center" }, children: [_jsx("div", { style: { display: "grid", placeItems: "center", marginBottom: 12 }, children: _jsx(BrandMark, { size: 48 }) }), _jsx("div", { style: { fontSize: 18, fontWeight: 760, marginBottom: 6 }, children: headline }), _jsx("p", { style: { color: c.textDim, fontSize: 13, lineHeight: 1.55, margin: "0 0 16px" }, children: state.accountMismatch
                        ? "Sign in again so this League account is linked to your LOBLY user."
                        : "LOBLY confirms you own this account by briefly changing your profile icon, then puts it back." }), state.summoner && (_jsxs("div", { style: { color: c.text, fontFamily: font.mono, fontSize: 12, marginBottom: 14 }, children: [state.summoner.gameName, "#", state.summoner.tagLine] })), progress && (_jsx("div", { style: { color: c.primary, fontSize: 12, marginBottom: 12 }, children: progress })), error && (_jsx("div", { style: {
                        color: c.loss,
                        background: c.lossSoft,
                        borderRadius: radius.md,
                        padding: "8px 10px",
                        fontSize: 12,
                        marginBottom: 12,
                    }, children: error })), _jsx(Button, { variant: "primary", disabled: !leagueReady || busy || !!progress, onClick: () => void verify(), children: busy && !dev ? "Working…" : "Verify with League client" }), !state.lcu.connected && (_jsx("div", { style: { marginTop: 10, color: c.textFaint, fontSize: 12 }, children: "Waiting for the League client\u2026" })), error && (_jsx("div", { style: { marginTop: 8 }, children: _jsx(Button, { disabled: busy || !leagueReady, onClick: () => void verify(), children: "Retry" }) })), dev && (_jsxs("div", { style: { marginTop: 18, textAlign: "left" }, children: [_jsx("div", { style: { fontSize: 11, color: c.textFaint, marginBottom: 6 }, children: "Dev login" }), _jsx("input", { value: email, onChange: (e) => setEmail(e.target.value), placeholder: "Email", style: inputStyle }), _jsx("input", { value: password, type: "password", onChange: (e) => setPassword(e.target.value), placeholder: "Password", style: { ...inputStyle, marginTop: 6 } }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(Button, { disabled: busy || !email || !password, onClick: () => void devLogin(), children: "Dev sign in" }) })] }))] }) }));
}
const inputStyle = {
    width: "100%",
    background: c.surfaceAlt,
    border: `1px solid ${c.border}`,
    borderRadius: radius.md,
    color: c.text,
    padding: "8px 10px",
    fontSize: 13,
};
