import { appStore } from "@lobly/client-core";
import { isLeagueGameId } from "../../shared/ow";

let listening = false;

export function startGameEvents() {
  overwolf.games.onGameLaunched.addListener((info) => {
    if (info?.id != null && isLeagueGameId(info.id)) {
      setMatchStateFeatures(0);
    }
  });

  overwolf.games.onGameInfoUpdated.addListener((update) => {
    const gi = update?.gameInfo;
    if (gi?.isRunning && gi.id != null && isLeagueGameId(gi.id)) {
      setMatchStateFeatures(0);
    }
  });

  // Already in game?
  overwolf.games.getRunningGameInfo((gi) => {
    if (gi?.isRunning && gi.id != null && isLeagueGameId(gi.id)) {
      setMatchStateFeatures(0);
    }
  });
}

function setMatchStateFeatures(attempt: number) {
  overwolf.games.events.setRequiredFeatures(["matchState"], (res) => {
    if (!res.success) {
      if (attempt < 20) {
        setTimeout(() => setMatchStateFeatures(attempt + 1), 3000);
      } else {
        appStore.logLine(`In-game GEP FAILED: ${res.error}`);
      }
      return;
    }
    appStore.logLine("In-game GEP matchState active");
    if (!listening) {
      overwolf.games.events.onNewEvents.addListener((e) => {
        const events = e?.events ?? [];
        for (const ev of events) {
          if (ev.name === "matchStart" || ev.name === "match_start") {
            appStore.logLine("GEP matchStart");
          }
          // No reliable matchOutcome for LoL (C11) — session end from launcher game_flow
        }
      });
      listening = true;
    }
  });
}
