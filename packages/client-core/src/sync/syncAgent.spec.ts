const handlers: Record<string, (arg?: any) => void> = {};
const socket = {
  connected: false,
  on(ev: string, fn: (arg?: any) => void) {
    handlers[ev] = fn;
  },
  connect: jest.fn(),
  disconnect: jest.fn(),
  emit: jest.fn(),
  removeAllListeners() {
    for (const key of Object.keys(handlers)) delete handlers[key];
  },
};

jest.mock("socket.io-client", () => ({
  io: jest.fn(() => socket),
}));

const refreshAccessToken = jest.fn(async () => true);

jest.mock("../api/client", () => ({
  getAccessToken: () => "tok",
  refreshAccessToken: () => refreshAccessToken(),
}));

jest.mock("../api/session", () => ({
  fetchFlags: async () => ({
    inviteAutomation: true,
    autoAccept: true,
    board: true,
    allowedPlatforms: ["euw1"],
  }),
  reportInviteResult: async () => undefined,
  fetchMyListing: async () => null,
  mergeSessionMessages: async () => undefined,
  normalizeChatMessage: (m: any) => m,
}));

jest.mock("../hostAdapter", () => ({
  getHostAdapter: () => ({
    backendUrl: "http://127.0.0.1:8790",
    isDesktopHidden: async () => false,
    notify: () => undefined,
  }),
}));

import { appStore } from "../state/store";
import { syncAgent } from "./syncAgent";

describe("syncAgent unauthorized refresh", () => {
  beforeEach(() => {
    refreshAccessToken.mockReset();
    refreshAccessToken.mockResolvedValue(true);
    socket.connect.mockClear();
    socket.disconnect.mockClear();
    appStore.update({ authExpired: false, authenticated: true });
  });

  it("refreshes and reconnects once when connect_error is unauthorized", async () => {
    syncAgent.connect("tok");
    handlers.connect_error?.({ message: "unauthorized" });
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(appStore.state.authExpired).toBe(false);
  });

  it("sets authExpired when the refresh fails", async () => {
    refreshAccessToken.mockResolvedValue(false);
    syncAgent.connect("tok");
    handlers.connect_error?.({ message: "unauthorized" });
    await Promise.resolve();
    await Promise.resolve();
    expect(appStore.state.authExpired).toBe(true);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
