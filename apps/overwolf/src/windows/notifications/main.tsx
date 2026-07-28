import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { useAppStore, getBridge } from "@lobly/client-core";
import { hideWindow, positionNotificationsBottomRight, restoreWindow } from "../../shared/ow";

function ToastApp() {
  const state = useAppStore();
  const toast = state.toast;
  const pending = state.pendingRequests?.[0];

  useEffect(() => {
    if (!toast && !pending) {
      void hideWindow("notifications");
      return;
    }
    void (async () => {
      await restoreWindow("notifications");
      await positionNotificationsBottomRight();
    })();
    if (!toast) return;
    const t = setTimeout(() => {
      getBridge()?.store.clearToast();
    }, 8000);
    return () => clearTimeout(t);
  }, [toast?.at, toast?.message, pending?.joinRequestId]);

  if (!toast && !pending) return null;

  const card = pending?.card?.account;
  const showActions = !!pending && toast?.message?.startsWith("Join request");

  return (
    <div
      style={{
        margin: 8,
        padding: "12px 14px",
        background: "rgba(18, 22, 28, 0.94)",
        color: "#e8edf2",
        border: "1px solid #3a4654",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>LOBLY</div>
      <div>{toast?.message ?? (card ? `Join: ${card.riotId}#${card.tagLine}` : "")}</div>
      {showActions && pending && (
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            style={actionBtn}
            onClick={() => {
              void getBridge()?.acceptJoin?.(pending.joinRequestId);
              getBridge()?.store.clearToast();
            }}
          >
            Accept
          </button>
          <button
            style={actionBtn}
            onClick={() => {
              void getBridge()?.declineJoin?.(pending.joinRequestId);
              getBridge()?.store.clearToast();
            }}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  background: "#1c2430",
  color: "#e8edf2",
  border: "1px solid #3a4654",
  cursor: "pointer",
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<ToastApp />);
