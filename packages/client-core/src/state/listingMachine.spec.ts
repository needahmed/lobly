import { ListingStatus, SocketEvents } from "@lobly/shared-types";
import { appStore } from "./store";
import { dispatchMachine } from "./listingMachine";
import { syncAgent } from "../sync/syncAgent";

describe("dispatchMachine session end", () => {
  const send = jest.spyOn(syncAgent, "send").mockImplementation(() => undefined);

  beforeEach(() => {
    appStore.update({
      listing: { status: ListingStatus.POST_SESSION, id: "listing-1" },
      gameflowPhase: "None",
      lobbyCapability: null,
    });
    dispatchMachine({ type: "EXPIRED" });
    send.mockClear();
  });

  afterAll(() => {
    send.mockRestore();
  });

  it("sends observedPhase and final=false when a game ends", () => {
    appStore.update({
      listing: { status: ListingStatus.IN_SESSION, id: "listing-1" },
      gameflowPhase: "InProgress",
    });
    dispatchMachine({ type: "PHASE", phase: "EndOfGame" });
    expect(send).toHaveBeenCalledWith(
      SocketEvents.SESSION_END,
      expect.objectContaining({
        listingId: "listing-1",
        observedPhase: "EndOfGame",
        final: false,
      })
    );
  });

  it("sends final=true when IN_SESSION returns to Lobby", () => {
    appStore.update({
      listing: { status: ListingStatus.IN_SESSION, id: "listing-1" },
    });
    dispatchMachine({ type: "PHASE", phase: "Lobby" });
    expect(send).toHaveBeenCalledWith(
      SocketEvents.SESSION_END,
      expect.objectContaining({
        listingId: "listing-1",
        observedPhase: "Lobby",
        final: true,
      })
    );
  });

  it("sends one final SESSION_END from POST_SESSION and resets on QUEUE_AGAIN", () => {
    appStore.update({
      listing: { status: ListingStatus.POST_SESSION, id: "listing-1" },
      gameflowPhase: "Lobby",
    });
    dispatchMachine({ type: "PHASE", phase: "None" });
    dispatchMachine({ type: "PHASE", phase: "Lobby" });
    const ends = send.mock.calls.filter((c) => c[0] === SocketEvents.SESSION_END);
    expect(ends).toHaveLength(1);
    expect(ends[0][1]).toEqual(
      expect.objectContaining({
        listingId: "listing-1",
        observedPhase: "None",
        final: true,
      })
    );

    dispatchMachine({ type: "QUEUE_AGAIN" });
    appStore.update({
      listing: { status: ListingStatus.POST_SESSION, id: "listing-1" },
    });
    dispatchMachine({ type: "PHASE", phase: "Lobby" });
    const after = send.mock.calls.filter((c) => c[0] === SocketEvents.SESSION_END);
    expect(after).toHaveLength(2);
    expect(after[1][1]).toEqual(
      expect.objectContaining({ observedPhase: "Lobby", final: true })
    );
  });
});
