import { useState, type CSSProperties } from "react";
import { ensureSession } from "../api/session";
import { getHostAdapter } from "../hostAdapter";
import { getBridge } from "../shared/bridge";
import type { AppState } from "../state/store";
import { c, radius, font } from "./theme";
import { BrandMark, Button, Card } from "./components";

export function SignInGate({ state }: { state: AppState }) {
  const dev =
    state.devAuthEnabled ||
    (() => {
      try {
        return getHostAdapter().isDevAuthEnabled?.() === true;
      } catch {
        return false;
      }
    })();
  const [email, setEmail] = useState("dev@lobly.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const leagueReady = state.lcu.connected && !!state.summoner;
  const progress = state.signInPhase;

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const run = getBridge()?.riotSignIn;
      if (!run) throw new Error("League sign-in is not available in this window");
      await run();
    } catch (e: any) {
      setError(e?.body?.message ?? e?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const devLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const run = getBridge()?.devSignIn;
      if (run) await run(email, password);
      else await ensureSession(email, password);
    } catch (e: any) {
      setError(e?.body?.message ?? e?.message ?? "Login failed");
    } finally {
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

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        padding: 28,
      }}
    >
      <Card style={{ width: "min(440px, 100%)", textAlign: "center" }}>
        <div style={{ display: "grid", placeItems: "center", marginBottom: 12 }}>
          <BrandMark size={48} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 760, marginBottom: 6 }}>{headline}</div>
        <p style={{ color: c.textDim, fontSize: 13, lineHeight: 1.55, margin: "0 0 16px" }}>
          {state.accountMismatch
            ? "Sign in again so this League account is linked to your LOBLY user."
            : "LOBLY confirms you own this account by briefly changing your profile icon, then puts it back."}
        </p>
        {state.summoner && (
          <div style={{ color: c.text, fontFamily: font.mono, fontSize: 12, marginBottom: 14 }}>
            {state.summoner.gameName}#{state.summoner.tagLine}
          </div>
        )}
        {progress && (
          <div style={{ color: c.primary, fontSize: 12, marginBottom: 12 }}>{progress}</div>
        )}
        {error && (
          <div
            style={{
              color: c.loss,
              background: c.lossSoft,
              borderRadius: radius.md,
              padding: "8px 10px",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <Button
          variant="primary"
          disabled={!leagueReady || busy || !!progress}
          onClick={() => void verify()}
        >
          {busy && !dev ? "Working…" : "Verify with League client"}
        </Button>
        {!state.lcu.connected && (
          <div style={{ marginTop: 10, color: c.textFaint, fontSize: 12 }}>
            Waiting for the League client…
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8 }}>
            <Button disabled={busy || !leagueReady} onClick={() => void verify()}>
              Retry
            </Button>
          </div>
        )}
        {dev && (
          <div style={{ marginTop: 18, textAlign: "left" }}>
            <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 6 }}>Dev login</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={inputStyle}
            />
            <input
              value={password}
              type="password"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{ ...inputStyle, marginTop: 6 }}
            />
            <div style={{ marginTop: 8 }}>
              <Button disabled={busy || !email || !password} onClick={() => void devLogin()}>
                Dev sign in
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  background: c.surfaceAlt,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  color: c.text,
  padding: "8px 10px",
  fontSize: 13,
};
