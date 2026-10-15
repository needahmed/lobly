import { ApiError, storeAuth } from "../api/client";
import { getHostAdapter } from "../hostAdapter";
/**
 * Sign in by proving control of the League client: the API picks a starter
 * profile icon, this function sets it, and the API polls Riot until it matches.
 * The previous icon is restored even when verify fails.
 */
export async function riotSignIn() {
    const transport = getHostAdapter().lcuTransport;
    const summoner = await transport.request("currentSummoner");
    const locale = await transport.request("regionLocale");
    const originalIconId = typeof summoner.profileIconId === "number" ? summoner.profileIconId : 0;
    const gameName = summoner.gameName ??
        (typeof summoner.displayName === "string" ? summoner.displayName.split("#")[0] : "");
    const tagLine = summoner.tagLine ?? "";
    const platform = String(locale?.region ?? "").toLowerCase();
    const challenge = await postJson("/v1/auth/riot/challenge", {
        gameName,
        tagLine,
        platform,
    });
    try {
        await transport.request("setSummonerIcon", {
            body: { profileIconId: challenge.iconId },
        });
        const tokens = await postJson("/v1/auth/riot/verify", {
            challengeId: challenge.challengeId,
            lcuPuuid: summoner.puuid,
            summonerId: summoner.summonerId,
        });
        storeAuth(tokens.accessToken, tokens.refreshToken);
        return tokens;
    }
    finally {
        await transport.request("setSummonerIcon", {
            body: { profileIconId: originalIconId },
        });
    }
}
async function postJson(path, body) {
    const { backendUrl } = getHostAdapter();
    const res = await fetch(`${backendUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok)
        throw new ApiError(res.status, parsed);
    return parsed;
}
