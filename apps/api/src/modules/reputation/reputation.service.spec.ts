import { BadRequestException } from "@nestjs/common";
import { ReputationService } from "./reputation.service";

function setup() {
  const reports = {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => ({ id: "report-1", ...row })),
  };
  const sessions = { findOne: jest.fn() };
  const accounts = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const redis = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  };
  const service = new ReputationService(
    {} as any,
    {} as any,
    {} as any,
    reports as any,
    sessions as any,
    accounts as any,
    {} as any,
    redis as any,
    {} as any
  );
  return { service, reports, sessions, accounts };
}

function codeOf(err: unknown): string {
  return (err as BadRequestException).getResponse() as any as string
    ? ((err as BadRequestException).getResponse() as { code: string }).code
    : "";
}

describe("ReputationService.report", () => {
  it("returns 400 NOT_FOUND when the account does not exist", async () => {
    const { service, accounts, reports } = setup();
    accounts.findOne.mockResolvedValue(null);
    await expect(
      service.report("user-1", {
        accountId: "missing",
        reason: "HARASSMENT",
      })
    ).rejects.toMatchObject({
      response: { code: "NOT_FOUND" },
      status: 400,
    });
    expect(reports.save).not.toHaveBeenCalled();
  });

  it("returns 400 CANNOT_REPORT_SELF for one of the reporter's accounts", async () => {
    const { service, accounts } = setup();
    accounts.findOne.mockResolvedValue({ id: "mine" });
    accounts.find.mockResolvedValue([{ id: "mine", userId: "user-1" }]);
    try {
      await service.report("user-1", { accountId: "mine", reason: "OTHER" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(codeOf(err)).toBe("CANNOT_REPORT_SELF");
      expect((err as BadRequestException).getStatus()).toBe(400);
    }
  });

  it("returns 400 NOT_MEMBER when sessionId is set and the reporter is not in it", async () => {
    const { service, accounts, sessions } = setup();
    accounts.findOne.mockResolvedValue({ id: "them" });
    accounts.find.mockResolvedValue([{ id: "mine", userId: "user-1" }]);
    sessions.findOne.mockResolvedValue({
      id: "s1",
      memberAccountIds: ["someone-else"],
    });
    try {
      await service.report("user-1", {
        accountId: "them",
        sessionId: "s1",
        reason: "BAIT_JOIN",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(codeOf(err)).toBe("NOT_MEMBER");
    }
  });

  it("saves a report when the target exists and the reporter is a member", async () => {
    const { service, accounts, sessions, reports } = setup();
    accounts.findOne.mockResolvedValue({ id: "them" });
    accounts.find.mockResolvedValue([{ id: "mine", userId: "user-1" }]);
    sessions.findOne.mockResolvedValue({
      id: "s1",
      memberAccountIds: ["mine", "them"],
    });
    const result = await service.report("user-1", {
      accountId: "them",
      sessionId: "s1",
      reason: "HARASSMENT",
    });
    expect(result).toEqual({ id: "report-1", status: "OPEN" });
    expect(reports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterAccountId: "mine",
        reportedAccountId: "them",
        sessionId: "s1",
      })
    );
  });
});

describe("ReputationService.endorse", () => {
  function endorseSetup() {
    const saved: any[] = [];
    const endorsements = {
      find: jest.fn(async () => saved),
      findOne: jest.fn(async (q: { where: any }) => {
        const w = q.where;
        return (
          saved.find(
            (row) =>
              row.sessionId === w.sessionId &&
              String(row.gameId) === String(w.gameId) &&
              row.fromAccountId === w.fromAccountId &&
              row.toAccountId === w.toAccountId &&
              row.kind === w.kind
          ) ?? null
        );
      }),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => {
        saved.push({ ...row, createdAt: row.createdAt ?? new Date() });
        return row;
      }),
    };
    const sessions = { findOne: jest.fn() };
    const accounts = { find: jest.fn(), findOne: jest.fn() };
    const service = new ReputationService(
      {} as any,
      endorsements as any,
      {} as any,
      {} as any,
      sessions as any,
      accounts as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, endorsements, sessions, accounts, saved };
  }

  const session = {
    id: "s1",
    memberAccountIds: ["me", "them"],
    endedAt: new Date(),
    riotVerifiedGameIds: ["99"],
  };

  it("rejects a third account with NOT_SESSION_MEMBER", async () => {
    const { service, sessions, accounts } = endorseSetup();
    sessions.findOne.mockResolvedValue(session);
    accounts.find.mockResolvedValue([{ id: "stranger", userId: "user-3" }]);
    await expect(
      service.endorse("user-3", "s1", "them", ["SKILLED"], 99)
    ).rejects.toMatchObject({ response: { code: "NOT_SESSION_MEMBER" } });
  });

  it("treats a replayed endorse as a no-op", async () => {
    const { service, sessions, accounts, endorsements } = endorseSetup();
    sessions.findOne.mockResolvedValue(session);
    accounts.find.mockResolvedValue([{ id: "me", userId: "user-1" }]);
    await service.endorse("user-1", "s1", "them", ["GOOD_TEAMMATE"], 99);
    await service.endorse("user-1", "s1", "them", ["GOOD_TEAMMATE"], 99);
    expect(endorsements.save).toHaveBeenCalledTimes(1);
  });

  it("counts a pair once per day", async () => {
    const { service, endorsements } = endorseSetup();
    const day = new Date("2026-10-15T01:00:00Z");
    const later = new Date("2026-10-15T18:00:00Z");
    const next = new Date("2026-10-16T01:00:00Z");
    endorsements.find.mockResolvedValue([
      { kind: "SKILLED", fromAccountId: "me", toAccountId: "them", createdAt: day },
      { kind: "SKILLED", fromAccountId: "me", toAccountId: "them", createdAt: later },
      { kind: "SKILLED", fromAccountId: "me", toAccountId: "them", createdAt: next },
      { kind: "SKILLED", fromAccountId: "other", toAccountId: "them", createdAt: day },
    ]);
    await expect(service.getEndorsementCounts("them")).resolves.toEqual({
      goodComms: 0,
      goodTeammate: 0,
      skilled: 3,
    });
  });
});
