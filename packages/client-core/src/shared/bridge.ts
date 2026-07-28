import type { AppState, Store } from "../state/store";
import type { MachineEvent } from "../state/listingMachine";

export interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  restore: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => boolean;
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void;
}

/** API the host process hangs on window.lobly (Electron: via preload's
 *  contextBridge; Overwolf: the background window sets it directly on
 *  itself and the desktop window reaches it via getMainWindow()). */
export interface LoblyBridge {
  store: Store;
  dispatch: (event: MachineEvent) => void;
  canPublish: () => { ok: boolean; reason: string | null };
  /** Publish using a draft built in the UI realm, in one hop. */
  publish?: (draft: unknown) => void;
  setToast: (message: string) => void;
  refreshBoard?: () => Promise<void>;
  sendChat?: (sessionId: string, body: string) => void;
  acceptJoin?: (joinRequestId: string) => Promise<void>;
  declineJoin?: (joinRequestId: string) => Promise<void>;
  /** Present only in Electron, where the shared shell owns the title bar. */
  windowControls?: WindowControls;
  spike?: {
    restGet: () => Promise<string>;
    restPost: (toSummonerId: number) => Promise<string>;
    wsA: () => string;
    wsB: () => string;
  };
}

export function getBridge(): LoblyBridge | null {
  try {
    const g = globalThis as any;
    // Electron (and any single-window host): preload sets window.lobly
    // directly on the same window the UI runs in.
    if (g.lobly) return g.lobly as LoblyBridge;
    // Overwolf: background window sets window.lobly on itself; the desktop
    // window is a separate JS realm and must reach across via getMainWindow().
    const ow = g.overwolf;
    if (ow?.windows?.getMainWindow) {
      const main = ow.windows.getMainWindow();
      if (main?.lobly) return main.lobly as LoblyBridge;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type { AppState };
