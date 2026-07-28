import type {
  AuthTokens,
  BoardRow,
  BoardSort,
  CreateListingBody,
  FeatureFlags,
  ListingSummary,
  MatchHistoryRow,
  PatchListingBody,
  ProfileCard,
  RiotAccountDto,
  UserPrefs,
} from "@lobly/shared-types";
import { apiFetch, clearAuth, getAccessToken, loadStoredAuth, storeAuth } from "./client";
import { appStore } from "../state/store";
import { syncAgent } from "../sync/syncAgent";

export async function ensureSession(email: string, password: string): Promise<AuthTokens> {
  loadStoredAuth();
  if (getAccessToken()) {
    try {
      const me = await apiFetch<unknown[]>("/v1/profiles/me");
      appStore.logLine(`API session restored (${me.length} linked accounts)`);
      syncAgent.connect(getAccessToken()!);
      return {
        accessToken: getAccessToken()!,
        refreshToken: "",
        user: { id: "", email, createdAt: "" },
      };
    } catch {
      clearAuth();
    }
  }

  try {
    const tokens = await apiFetch<AuthTokens>(
      "/v1/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false
    );
    storeAuth(tokens.accessToken, tokens.refreshToken);
    syncAgent.connect(tokens.accessToken);
    appStore.logLine(`API login ok as ${email}`);
    return tokens;
  } catch (e: any) {
    appStore.logLine(`API login failed (${e?.message ?? e}) — trying register`);
    const tokens = await apiFetch<AuthTokens>(
      "/v1/auth/register",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false
    );
    storeAuth(tokens.accessToken, tokens.refreshToken);
    syncAgent.connect(tokens.accessToken);
    appStore.logLine(`API registered ${email}`);
    return tokens;
  }
}

export async function linkCurrentSummoner(): Promise<RiotAccountDto | null> {
  const s = appStore.state.summoner;
  if (!s || !getAccessToken()) return null;
  // The LCU's puuid is a local uuid Riot's Web API rejects, so identity
  // travels as the Riot ID and the server resolves the real PUUID itself.
  const account = await apiFetch<RiotAccountDto>("/v1/riot-accounts/link", {
    method: "POST",
    body: JSON.stringify({
      gameName: s.gameName,
      tagLine: s.tagLine,
      platform: s.platform,
      lcuPuuid: s.puuid,
      summonerId: s.summonerId,
    }),
  });
  appStore.update({ riotAccountId: account.id });
  appStore.logLine(`Riot linked ${account.riotId}#${account.tagLine} (${account.id})`);
  // Seed rank/role hints for publish presets (best-effort)
  void fetchMyProfiles()
    .then((cards) => {
      const card = cards.find((c) => c.account.id === account.id) ?? cards[0];
      if (!card?.snapshot) return;
      appStore.update({
        profileHints: {
          soloTier: card.snapshot.solo?.tier ?? null,
          soloDivision: card.snapshot.solo?.division ?? null,
          flexTier: card.snapshot.flex?.tier ?? null,
          flexDivision: card.snapshot.flex?.division ?? null,
          primaryRole: card.snapshot.primaryRole,
          secondaryRole: card.snapshot.secondaryRole,
          languages: card.prefs?.languages,
        },
      });
    })
    .catch(() => undefined);
  return account;
}

export async function createListing(body: CreateListingBody): Promise<ListingSummary> {
  const listing = await apiFetch<ListingSummary>("/v1/listings", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  appStore.update({
    listing: { status: listing.status as never, id: listing.id },
    myListing: listing,
  });
  appStore.logLine(`Listing created ${listing.id}`);
  return listing;
}

export async function patchListing(
  id: string,
  body: PatchListingBody
): Promise<ListingSummary> {
  const listing = await apiFetch<ListingSummary>(`/v1/listings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  appStore.update({ myListing: listing });
  appStore.logLine(`Listing patched ${id}`);
  return listing;
}

export async function reconcileListingSlots(
  id: string,
  freeSeats: number
): Promise<ListingSummary> {
  return apiFetch<ListingSummary>(`/v1/listings/${id}/reconcile-slots`, {
    method: "POST",
    body: JSON.stringify({ freeSeats }),
  });
}

export interface BoardQuery {
  queueId?: number;
  roles?: string;
  minRank?: string;
  maxRank?: string;
  voice?: string;
  language?: string;
  sort?: BoardSort;
  riotAccountId?: string;
}

export async function fetchBoard(
  queueIdOrQuery?: number | BoardQuery
): Promise<BoardRow[]> {
  const q: BoardQuery =
    typeof queueIdOrQuery === "number"
      ? { queueId: queueIdOrQuery, sort: "score" }
      : { sort: "score", ...(queueIdOrQuery ?? {}) };
  const qs = new URLSearchParams();
  if (q.queueId != null) qs.set("queueId", String(q.queueId));
  if (q.roles) qs.set("roles", q.roles);
  if (q.minRank) qs.set("minRank", q.minRank);
  if (q.maxRank) qs.set("maxRank", q.maxRank);
  if (q.voice) qs.set("voice", q.voice);
  if (q.language) qs.set("language", q.language);
  if (q.sort) qs.set("sort", q.sort);
  if (q.riotAccountId) qs.set("riotAccountId", q.riotAccountId);
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<BoardRow[]>(`/v1/board${suffix}`);
}

export async function fetchMyListing(): Promise<ListingSummary | null> {
  return apiFetch<ListingSummary | null>("/v1/listings/mine");
}

export async function pauseListing(id: string): Promise<void> {
  await apiFetch(`/v1/listings/${id}/state`, {
    method: "POST",
    body: JSON.stringify({ event: "pause" }),
  });
}

export async function delistListing(id: string): Promise<void> {
  await apiFetch(`/v1/listings/${id}/state`, {
    method: "POST",
    body: JSON.stringify({ event: "delist" }),
  });
  appStore.update({ myListing: null });
}

export async function requestJoin(listingId: string, roleSlot?: string) {
  return apiFetch<{ joinRequestId: string; matchScore: number; offRole: boolean }>(
    `/v1/listings/${listingId}/join`,
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ roleSlot }),
    }
  );
}

export async function acceptJoin(joinRequestId: string) {
  return apiFetch(`/v1/join-requests/${joinRequestId}/accept`, { method: "POST" });
}

export async function declineJoin(joinRequestId: string) {
  return apiFetch(`/v1/join-requests/${joinRequestId}/decline`, { method: "POST" });
}

export async function reportInviteResult(
  joinRequestId: string,
  ok: boolean,
  error?: string
) {
  return apiFetch(`/v1/join-requests/${joinRequestId}/invite-result`, {
    method: "POST",
    body: JSON.stringify({ ok, error }),
  });
}

export async function fetchListingRequests(listingId: string) {
  return apiFetch<
    {
      id: string;
      status: string;
      roleSlot: string | null;
      matchScore: number | null;
      offRole: boolean;
      card: ProfileCard;
    }[]
  >(`/v1/listings/${listingId}/requests`);
}

export async function fetchMyProfiles(): Promise<ProfileCard[]> {
  return apiFetch<ProfileCard[]>("/v1/profiles/me");
}

export async function fetchMatchHistory(
  riotAccountId: string,
  opts: { limit?: number; queueId?: number } = {}
): Promise<MatchHistoryRow[]> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.queueId) qs.set("queueId", String(opts.queueId));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<MatchHistoryRow[]>(
    `/v1/profiles/${riotAccountId}/matches${suffix}`
  );
}

export async function updatePrefs(body: Partial<UserPrefs>): Promise<UserPrefs> {
  return apiFetch<UserPrefs>("/v1/prefs", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function fetchFlags(): Promise<FeatureFlags> {
  return apiFetch<FeatureFlags>("/config/flags", {}, false);
}

export interface StaticData {
  version: string;
  champions: Record<string, { name: string; key: string; iconUrl: string }>;
  summonerSpells: Record<string, { name: string; iconUrl: string }>;
  runes: Record<string, { name: string; iconUrl: string }>;
  itemIconTemplate: string;
  profileIconTemplate: string;
}

export async function fetchStaticData(): Promise<StaticData> {
  return apiFetch<StaticData>("/static/ddragon", {}, false);
}

export async function fetchSessionMessages(sessionId: string) {
  return apiFetch<
    { id: number; sessionId: string; fromAccountId: string; body: string; createdAt: string }[]
  >(`/v1/sessions/${sessionId}/messages`);
}

export async function endorse(
  sessionId: string,
  toAccountId: string,
  kinds: string[]
) {
  return apiFetch(`/v1/sessions/${sessionId}/endorse`, {
    method: "POST",
    body: JSON.stringify({ toAccountId, kinds }),
  });
}
