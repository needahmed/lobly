import { hasCreds, getCreds } from "./credentials";
import { lcuRawFetch } from "./request";
import { appStore } from "@lobly/client-core";

export async function spikeRestGet(): Promise<string> {
  if (!hasCreds()) throw new Error("no LCU creds");
  const r = await lcuRawFetch("/lol-summoner/v1/current-summoner");
  appStore.logLine(`SPIKE REST GET → ${r.status}`);
  return `REST GET ${r.status}\n${JSON.stringify(r.body, null, 2)}`;
}

export async function spikeRestPost(toSummonerId: number): Promise<string> {
  if (!hasCreds()) throw new Error("no LCU creds");
  if (!Number.isFinite(toSummonerId)) throw new Error("enter toSummonerId");
  const r = await lcuRawFetch("/lol-lobby/v2/lobby/invitations", {
    method: "POST",
    body: [{ toSummonerId }],
  });
  appStore.logLine(`SPIKE REST POST invite → ${r.status}`);
  return `REST POST ${r.status}\n${JSON.stringify(r.body, null, 2)}`;
}

export function spikeWsA(): string {
  if (!hasCreds()) throw new Error("no LCU creds");
  const { port, token } = getCreds();
  const password = atob(token).split(":")[1];
  const url = `wss://riot:${password}@127.0.0.1:${port}/`;
  const ws = new WebSocket(url, "wamp");
  ws.onopen = () => {
    ws.send(JSON.stringify([5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]));
    appStore.logLine("SPIKE WS A → open");
    appStore.update({ wsAvailable: true });
  };
  ws.onerror = () => appStore.logLine("SPIKE WS A → error");
  ws.onclose = (ev) => appStore.logLine(`SPIKE WS A → close ${ev.code}`);
  ws.onmessage = (ev) =>
    appStore.logLine(`SPIKE WS A msg: ${String(ev.data).slice(0, 120)}`);
  return "WS A: connecting… (watch log)";
}

export function spikeWsB(): string {
  if (!hasCreds()) throw new Error("no LCU creds");
  const { port } = getCreds();
  const ws = new WebSocket(`wss://127.0.0.1:${port}/`, "wamp");
  ws.onopen = () => {
    ws.send(JSON.stringify([5, "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase"]));
    appStore.logLine("SPIKE WS B → open");
    appStore.update({ wsAvailable: true });
  };
  ws.onerror = () => appStore.logLine("SPIKE WS B → error");
  ws.onclose = (ev) => appStore.logLine(`SPIKE WS B → close ${ev.code}`);
  return "WS B: connecting… (watch log)";
}
