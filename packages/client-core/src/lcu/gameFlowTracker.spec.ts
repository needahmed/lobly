import type { GameContext, PhaseEdge } from "@lobly/shared-types";
import { GameFlowTracker } from "./gameFlowTracker";
import { SerialQueue } from "./serialQueue";
import { champSelect, gameflowSession, lobby } from "./__fixtures__/lcu";

function makeTracker(fetch?: (endpoint: string) => Promise<unknown>) {
  const logs: string[] = [];
  const tracker = new GameFlowTracker({ fetch, log: (l) => logs.push(l), now: () => 1 });
  const edges: PhaseEdge[] = [];
  const parties: number[] = [];
  tracker.onPhase((e) => edges.push(e));
  tracker.onParty((s) => parties.push(s.members.length));
  return { tracker, edges, parties, logs };
}

describe("SerialQueue", () => {
  it("runs jobs in order even when an earlier one is slower", async () => {
    const q = new SerialQueue();
    const order: number[] = [];
    void q.push(() => new Promise<void>((r) => setTimeout(() => (order.push(1), r()), 20)));
    void q.push(() => void order.push(2));
    await q.idle();
    expect(order).toEqual([1, 2]);
  });

  it("keeps going after a job throws", async () => {
    const q = new SerialQueue();
    const ran: string[] = [];
    void q.push(() => {
      throw new Error("boom");
    }).catch(() => undefined);
    void q.push(() => void ran.push("after"));
    await q.idle();
    expect(ran).toEqual(["after"]);
  });
});

describe("GameFlowTracker", () => {
  it("emits one phase edge per change when GEP and the socket both report it", async () => {
    const { tracker, edges } = makeTracker();
    void tracker.ingest("phase", "Lobby"); // GEP
    void tracker.ingest("gameflowSession", gameflowSession("Lobby")); // WS
    void tracker.ingest("phase", "Lobby"); // GEP repeat
    void tracker.ingest("phase", "Matchmaking");
    void tracker.ingest("gameflowSession", gameflowSession("Matchmaking"));
    await tracker.idle();
    expect(edges.map((e) => [e.from, e.to, e.legal])).toEqual([
      [null, "Lobby", true],
      ["Lobby", "Matchmaking", true],
    ]);
  });

  it("still delivers a phase that returns after the other channel moved it", async () => {
    const { tracker, edges } = makeTracker();
    void tracker.ingest("phase", "Lobby");
    void tracker.ingest("gameflowSession", gameflowSession("Matchmaking"));
    void tracker.ingest("phase", "Lobby"); // queue cancelled
    await tracker.idle();
    expect(edges.map((e) => e.to)).toEqual(["Lobby", "Matchmaking", "Lobby"]);
  });

  it("flags edges outside the transition table instead of hiding them", async () => {
    const { tracker, edges } = makeTracker();
    void tracker.ingest("phase", "EndOfGame");
    void tracker.ingest("phase", "InProgress");
    await tracker.idle();
    expect(edges[1]).toMatchObject({ from: "EndOfGame", to: "InProgress", legal: false });
  });

  it("does not re-emit the party for byte-identical lobby pushes", async () => {
    const { tracker, parties } = makeTracker();
    void tracker.ingest("lobby", lobby());
    void tracker.ingest("lobby", lobby());
    void tracker.ingest("lobby", lobby());
    await tracker.idle();
    expect(parties).toEqual([2]);
  });

  it("re-reads over REST when a pushed payload is unusable", async () => {
    const calls: string[] = [];
    const { tracker, parties } = makeTracker(async (endpoint) => {
      calls.push(endpoint);
      return lobby();
    });
    void tracker.ingest("lobby", { notALobby: true });
    await tracker.idle();
    expect(calls).toEqual(["lobby"]);
    expect(parties).toEqual([2]);
  });

  it("fires game-started once per gameId with the party frozen in", async () => {
    const { tracker } = makeTracker();
    const started: GameContext[] = [];
    tracker.onGameStarted((ctx) => started.push(ctx));
    void tracker.ingest("lobby", lobby());
    void tracker.ingest("gameflowSession", gameflowSession("ChampSelect", { gameId: 0 }));
    void tracker.ingest("champSelect", champSelect());
    void tracker.ingest("gameflowSession", gameflowSession("GameStart", { gameId: 99 }));
    void tracker.ingest("gameflowSession", gameflowSession("InProgress", { gameId: 99 }));
    void tracker.ingest("lobby", null); // lobby resource goes away mid-game
    void tracker.ingest("gameflowSession", gameflowSession("WaitingForStats", { gameId: 99 }));
    await tracker.idle();
    expect(started.map((c) => c.gameId)).toEqual([99]);
    expect(started[0].memberPuuids).toEqual(["local-uuid-1", "friend-uuid-2"]);
    expect(started[0].partyId).toBe("party-abc");
    expect(tracker.getGameContext()?.gameId).toBe(99);
    expect(tracker.getState().members).toHaveLength(2);
  });

  it("ignores a stale session from the previous queue and logs it", async () => {
    const { tracker, edges, logs } = makeTracker();
    void tracker.ingest("gameflowSession", gameflowSession("ChampSelect", { queueId: 420 }));
    void tracker.ingest("gameflowSession", gameflowSession("InProgress", { queueId: 440, gameId: 5 }));
    await tracker.idle();
    expect(edges.map((e) => e.to)).toEqual(["ChampSelect"]);
    expect(logs.some((l) => l.includes("stale"))).toBe(true);
  });

  it("replays phases after reset (LCU reconnect)", async () => {
    const { tracker, edges } = makeTracker();
    void tracker.ingest("phase", "Lobby");
    await tracker.reset();
    void tracker.ingest("phase", "Lobby");
    await tracker.idle();
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      [null, "Lobby"],
      [null, "Lobby"],
    ]);
  });
});
