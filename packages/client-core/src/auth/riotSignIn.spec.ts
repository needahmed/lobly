import { ApiError } from "../api/client";
import { getHostAdapter } from "../hostAdapter";
import { riotSignIn } from "./riotSignIn";

jest.mock("../hostAdapter", () => ({
  getHostAdapter: jest.fn(),
}));

const request = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("riotSignIn", () => {
  beforeEach(() => {
    request.mockReset();
    (getHostAdapter as jest.Mock).mockReturnValue({
      backendUrl: "http://api.test",
      lcuTransport: { request },
    });
    const mem = new Map<string, string>();
    Object.defineProperty(global, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    });
    request.mockImplementation(async (name: string) => {
      if (name === "currentSummoner") {
        return {
          puuid: "lcu-uuid",
          gameName: "Player",
          tagLine: "EUW",
          profileIconId: 4,
          summonerId: 9,
        };
      }
      if (name === "regionLocale") return { region: "EUW1" };
      return {};
    });
  });

  it("restores the original icon when verify throws", async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith("/v1/auth/riot/challenge")) {
        return jsonResponse(200, {
          challengeId: "11111111-1111-1111-1111-111111111111",
          iconId: 7,
          expiresAt: "2026-01-01T00:10:00.000Z",
        });
      }
      return jsonResponse(400, { code: "ICON_NOT_CHANGED" });
    }) as unknown as typeof fetch;

    await expect(riotSignIn()).rejects.toBeInstanceOf(ApiError);

    const iconCalls = request.mock.calls.filter((c) => c[0] === "setSummonerIcon");
    expect(iconCalls).toEqual([
      ["setSummonerIcon", { body: { profileIconId: 7 } }],
      ["setSummonerIcon", { body: { profileIconId: 4 } }],
    ]);
  });

  it("stores tokens after a successful verify and still restores the icon", async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).endsWith("/v1/auth/riot/challenge")) {
        return jsonResponse(200, {
          challengeId: "11111111-1111-1111-1111-111111111111",
          iconId: 7,
          expiresAt: "2026-01-01T00:10:00.000Z",
        });
      }
      return jsonResponse(200, {
        accessToken: "access",
        refreshToken: "refresh",
        user: { id: "user-1", email: null, createdAt: "2026-01-01T00:00:00.000Z" },
      });
    }) as unknown as typeof fetch;

    const tokens = await riotSignIn();
    expect(tokens.accessToken).toBe("access");
    expect(JSON.parse(localStorage.getItem("lobly.auth") ?? "{}")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
    const iconCalls = request.mock.calls.filter((c) => c[0] === "setSummonerIcon");
    expect(iconCalls[1]).toEqual(["setSummonerIcon", { body: { profileIconId: 4 } }]);
  });
});
