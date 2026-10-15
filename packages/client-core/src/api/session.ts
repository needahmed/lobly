import type {
  AuthTokens,
  BoardRow,
  BoardSort,
  ChatMessagePayload,
  CreateListingBody,
  FeatureFlags,
  ListingSummary,
  MatchHistoryRow,
  PatchListingBody,
  ProfileCard,
  ReportReason,
  RiotAccountDto,
  UserPrefs,
} from "@lobly/shared-types";
import {
  ApiError,
  apiFetch,
  clearAuth,
  getAccessToken,
  loadStoredAuth,
  logoutRemote,
  storeAuth,
} from "./client";
import { getHostAdapter } from "../hostAdapter";
import { appStore, type OutgoingRequest } from "../state/store";
import { getBridge } from "../shared/bridge";
import { syncAgent } from "../sync/syncAgent";

function uiStore() {
  return getBridge()?.store ?? appStore;
}

/** Login only. Never registers. Dev hosts call this when their dev flag is on. */
export async function ensureSession(email: string, password: string): Promise<AuthTokens> {
  const tokens = await apiFetch<AuthTokens>(
    "/v1/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false
  );
  storeAuth(tokens.accessToken, tokens.refreshToken);
  appStore.update({
    authenticated: true,
    authExpired: false,
    apiUnreachable: false,
    authChecked: true,
    hasStoredSession: true,
  });
  syncAgent.connect(tokens.accessToken);
  appStore.logLine(`API login ok as ${email}`);
  await afterSignIn();
  return tokens;
}

/**
 * Restore a stored token pair and open the socket. Retries with backoff when
 * the API cannot be reached. Does not fall back to a dev socket.
 */
export function startSessionBootstrap(opts?: {
  devAuth?: boolean;
  devEmail?: string;
  devPassword?: string;
}) {
  let delay = 5_000;
  const attempt = async () => {
    const stored = loadStoredAuth();
    appStore.update({ hasStoredSession: !!stored?.accessToken, devAuthEnabled: !!opts?.devAuth });
    try {
      if (stored?.accessToken) {
        await apiFetch<unknown[]>("/v1/profiles/me");
        appStore.update({
          authenticated: true,
          authExpired: false,
          apiUnreachable: false,
          authChecked: true,
        });
        syncAgent.connect(getAccessToken()!);
        appStore.logLine("API session restored");
        await afterSignIn();
        return;
      }
      if (opts?.devAuth && opts.devEmail && opts.devPassword) {
        await ensureSession(opts.devEmail, opts.devPassword);
        return;
      }
      appStore.update({
        authenticated: false,
        apiUnreachable: false,
        authChecked: true,
      });
    } catch (e: any) {
      if (e instanceof ApiError) {
        clearAuth();
        appStore.update({
          authenticated: false,
          authExpired: true,
          hasStoredSession: false,
          apiUnreachable: false,
          authChecked: true,
        });
        appStore.logLine(`API session rejected (${e.message})`);
        return;
      }
      appStore.update({ apiUnreachable: true, authChecked: true });
      appStore.logLine(
        `Can't reach LOBLY servers (${e?.message ?? e}) — retrying in ${Math.round(delay / 1000)}s`
      );
      const wait = delay;
      delay = Math.min(60_000, delay * 2);
      setTimeout(() => void attempt(), wait);
    }
  };
  void attempt();
}

async function afterSignIn() {
  await ensureDefaultPrefs().catch((e: any) =>
    appStore.logLine(`prefs: ${e?.message ?? e}`)
  );
  await adoptLinkedAccounts().catch(() => undefined);
  await refreshOutgoingRequests().catch(() => undefined);
}

/** First sign-in: if the server has no prefs row, seed language + voice. */
export async function ensureDefaultPrefs(): Promise<void> {
  const cards = await fetchMyProfiles();
  if (cards.some((c) => c.prefs)) return;
  const raw =
    typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
  const slice = raw.slice(0, 2).toLowerCase();
  const lang = /^[a-z]{2}$/.test(slice) ? slice : "en";
  const prefs = await updatePrefs({ languages: [lang], voice: "LEAGUE_VOICE" });
  appStore.update({
    autoAcceptLoblyInvites: prefs.autoAcceptLoblyInvites,
    profileHints: { ...appStore.state.profileHints, languages: prefs.languages },
  });
  appStore.logLine(`prefs seeded (${lang}, LEAGUE_VOICE)`);
}

export async function adoptLinkedAccounts(): Promise<void> {
  const accounts = await listRiotAccounts();
  const s = appStore.state.summoner;
  const match = s
    ? accounts.find(
        (a) =>
          a.riotId.toLowerCase() === s.gameName.toLowerCase() &&
          a.tagLine.toLowerCase() === s.tagLine.toLowerCase()
      )
    : undefined;
  appStore.update({
    linkedAccountIds: accounts.map((a) => a.id),
    linkedRiotIds: accounts.map((a) => `${a.riotId}#${a.tagLine}`),
    ...(match
      ? {
          riotAccountId: match.id,
          accountMismatch: false,
          linkedLcuPuuids: s
            ? [...new Set([...(appStore.state.linkedLcuPuuids ?? []), s.puuid])]
            : appStore.state.linkedLcuPuuids,
        }
      : {}),
  });
}

/** PUUID changed under an authenticated user. Returns whether it switched. */
export async function noteSummonerSwitch(next: {
  puuid: string;
  gameName: string;
  tagLine: string;
}): Promise<boolean> {
  const prev = appStore.state.summoner?.puuid;
  if (!prev || prev === next.puuid) return false;
  if (!appStore.state.authenticated) return true;
  try {
    const accounts = await listRiotAccounts();
    const key = `${next.gameName}#${next.tagLine}`.toLowerCase();
    const match = accounts.find((a) => `${a.riotId}#${a.tagLine}`.toLowerCase() === key);
    const puuidLinked = (appStore.state.linkedLcuPuuids ?? []).includes(next.puuid);
    appStore.update({
      linkedAccountIds: accounts.map((a) => a.id),
      linkedRiotIds: accounts.map((a) => `${a.riotId}#${a.tagLine}`),
      accountMismatch: !match && !puuidLinked,
      riotAccountId: match?.id,
      profileHints: undefined,
      myListing: null,
    });
  } catch {
    const puuidLinked = (appStore.state.linkedLcuPuuids ?? []).includes(next.puuid);
    if (!puuidLinked) {
      appStore.update({
        accountMismatch: true,
        riotAccountId: undefined,
        profileHints: undefined,
        myListing: null,
      });
    }
  }
  return true;
}

export async function signOut(): Promise<void> {
  await logoutRemote();
  clearAuth();
  syncAgent.disconnect();
  appStore.resetForSignOut();
  appStore.logLine("Signed out");
}

export async function listRiotAccounts(): Promise<RiotAccountDto[]> {
  return apiFetch<RiotAccountDto[]>("/v1/riot-accounts");
}

export async function unlinkRiotAccount(id: string): Promise<void> {
  await apiFetch(`/v1/riot-accounts/${id}`, { method: "DELETE" });
}

export async function deleteMyAccount(): Promise<void> {
  await apiFetch("/v1/users/me", { method: "DELETE" });
}

export async function linkCurrentSummoner(): Promise<RiotAccountDto | null> {
  if (!getAccessToken()) return null;
  const transport = getHostAdapter().lcuTransport;
  const summoner = await transport.request<{
    puuid?: string;
    gameName?: string;
    tagLine?: string;
    profileIconId?: number;
    summonerId?: number;
  }>("currentSummoner");
  let region: { region?: string } | null = null;
  try {
    region = await transport.request<{ region?: string }>("regionLocale");
  } catch {
    region = null;
  }
  const platform = String(
    region?.region ?? appStore.state.summoner?.platform ?? ""
  ).toLowerCase();
  const originalIcon = Number(summoner?.profileIconId ?? 0);
  const gameName = String(summoner?.gameName ?? appStore.state.summoner?.gameName ?? "");
  const tagLine = String(summoner?.tagLine ?? appStore.state.summoner?.tagLine ?? "");
  const challenge = await apiFetch<{ challengeId: string; iconId: number }>(
    "/v1/auth/riot/challenge",
    {
      method: "POST",
      body: JSON.stringify({ gameName, tagLine, platform }),
    },
    false
  );
  let account: RiotAccountDto;
  try {
    await transport.request("setSummonerIcon", {
      body: { profileIconId: challenge.iconId },
    });
    account = await apiFetch<RiotAccountDto>("/v1/riot-accounts/link", {
      method: "POST",
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        lcuPuuid: summoner?.puuid,
        summonerId: Number(summoner?.summonerId ?? 0),
      }),
    });
  } finally {
    try {
      await transport.request("setSummonerIcon", {
        body: { profileIconId: originalIcon },
      });
    } catch (e: any) {
      appStore.logLine(`icon restore failed: ${e?.message ?? e}`);
    }
  }
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

export async function reconcileListingParty(
  id: string,
  body: {
    partyId?: string | null;
    queueId: number;
    members: { puuid: string; summonerId: number; roles: string[]; isLeader: boolean }[];
    filledRoles: string[];
    phase: string;
  }
): Promise<ListingSummary> {
  return apiFetch<ListingSummary>(`/v1/listings/${id}/party`, {
    method: "PATCH",
    body: JSON.stringify(body),
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
  const result = await apiFetch<{ joinRequestId: string; matchScore: number; offRole: boolean }>(
    `/v1/listings/${listingId}/join`,
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(roleSlot ? { roleSlot } : {}),
    }
  );
  const store = uiStore();
  const next: OutgoingRequest = {
    id: result.joinRequestId,
    listingId,
    status: "PENDING",
    roleSlot: roleSlot ?? null,
  };
  store.update({
    outgoingRequests: [
      next,
      ...(store.state.outgoingRequests ?? []).filter((r) => r.id !== next.id),
    ],
  });
  return result;
}

export async function fetchMyJoinRequests(): Promise<OutgoingRequest[]> {
  const rows = await apiFetch<
    {
      id: string;
      listingId: string;
      status: string;
      roleSlot: string | null;
      createdAt?: string;
      listing?: { title?: string } | null;
      creator?: { riotId: string; tagLine: string } | null;
    }[]
  >("/v1/join-requests/mine");
  return rows.map((r) => ({
    id: r.id,
    listingId: r.listingId,
    status: r.status,
    roleSlot: r.roleSlot,
    createdAt: r.createdAt,
    listingTitle: r.listing?.title ?? null,
    creator: r.creator ?? null,
  }));
}

export async function refreshOutgoingRequests(): Promise<void> {
  try {
    const rows = await fetchMyJoinRequests();
    uiStore().update({ outgoingRequests: rows });
  } catch (e: any) {
    appStore.logLine(`outgoing requests: ${e?.message ?? e}`);
  }
}

export async function cancelJoin(id: string): Promise<void> {
  await apiFetch(`/v1/join-requests/${id}/cancel`, { method: "POST" });
  const store = uiStore();
  store.update({
    outgoingRequests: (store.state.outgoingRequests ?? []).map((r) =>
      r.id === id ? { ...r, status: "CANCELLED" } : r
    ),
  });
}

/** Accept or decline, and drop the card from pendingRequests. */
export async function decideJoin(id: string, accept: boolean): Promise<void> {
  await (accept ? acceptJoin(id) : declineJoin(id));
  const store = uiStore();
  store.update({
    pendingRequests: (store.state.pendingRequests ?? []).filter((r) => r.joinRequestId !== id),
  });
}

export async function blockAccount(accountId: string): Promise<void> {
  await apiFetch("/v1/blocks", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
}

export async function unblockAccount(accountId: string): Promise<void> {
  await apiFetch(`/v1/blocks/${accountId}`, { method: "DELETE" });
}

export async function listBlocks(): Promise<{ accountId: string; createdAt: string }[]> {
  return apiFetch("/v1/blocks");
}

export async function reportAccount(body: {
  accountId: string;
  reason: ReportReason;
  detail?: string;
  sessionId?: string;
}): Promise<void> {
  await apiFetch("/v1/reports", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      detail: body.detail ? body.detail.slice(0, 500) : undefined,
    }),
  });
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

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessagePayload[]> {
  const rows = await apiFetch<any[]>(`/v1/sessions/${sessionId}/messages`);
  return rows.map(normalizeChatMessage);
}

export function normalizeChatMessage(m: any): ChatMessagePayload {
  if (m?.from?.accountId) {
    return {
      id: Number(m.id),
      sessionId: String(m.sessionId),
      from: {
        accountId: String(m.from.accountId),
        riotId: String(m.from.riotId ?? ""),
        tagLine: String(m.from.tagLine ?? ""),
      },
      body: String(m.body ?? ""),
      at: String(m.at ?? m.createdAt ?? ""),
    };
  }
  return {
    id: Number(m.id),
    sessionId: String(m.sessionId),
    from: {
      accountId: String(m.fromAccountId ?? ""),
      riotId: "",
      tagLine: "",
    },
    body: String(m.body ?? ""),
    at: String(m.createdAt ?? m.at ?? ""),
  };
}

export async function mergeSessionMessages(sessionId: string): Promise<void> {
  const incoming = await fetchSessionMessages(sessionId);
  const store = uiStore();
  const cur = store.state.session;
  if (!cur || cur.id !== sessionId) return;
  const byId = new Map<number, ChatMessagePayload>();
  for (const m of [...(cur.chat ?? []), ...incoming]) {
    const norm = normalizeChatMessage(m);
    if (Number.isFinite(norm.id)) byId.set(norm.id, norm);
  }
  const chat = [...byId.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  store.update({
    session: { ...cur, chat },
  });
}

export async function fetchActiveSession(): Promise<{
  sessionId: string;
  memberAccountIds: string[];
  endedAt?: string | null;
  chatOpenUntil?: string | null;
} | null> {
  return apiFetch("/v1/sessions/active");
}

export async function endorse(
  sessionId: string,
  toAccountId: string,
  kinds: string[],
  gameId?: number
) {
  return apiFetch(`/v1/sessions/${sessionId}/endorse`, {
    method: "POST",
    body: JSON.stringify({ toAccountId, kinds, gameId }),
  });
}
