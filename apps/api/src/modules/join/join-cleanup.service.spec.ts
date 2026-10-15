import { SocketEvents } from "@lobly/shared-types";
import { JoinCleanupService } from "./join-cleanup.service";

function setup() {
  const rows: any[] = [];
  const joins = {
    find: jest.fn(async ({ where }: any) =>
      rows.filter((r) => {
        if (where.listingId && r.listingId !== where.listingId) return false;
        if (where.status && r.status !== where.status) return false;
        if (where.requesterAccountId?._value) {
          const ids = where.requesterAccountId._value as string[];
          if (!ids.includes(r.requesterAccountId)) return false;
        } else if (
          typeof where.requesterAccountId === "string" &&
          r.requesterAccountId !== where.requesterAccountId
        ) {
          return false;
        }
        return true;
      })
    ),
    save: jest.fn(async (row: any) => row),
  };
  const accounts = {
    find: jest.fn(async () => [{ id: "acc-1", userId: "user-1" }]),
    findOne: jest.fn(async ({ where }: any) =>
      where.id === "acc-1" ? { id: "acc-1", userId: "user-1" } : null
    ),
  };
  const fanout = { emitToUser: jest.fn() };
  const queue = { remove: jest.fn() };
  const service = new JoinCleanupService(
    joins as any,
    accounts as any,
    fanout as any,
    queue as any
  );
  return { service, joins, accounts, fanout, queue, rows };
}

describe("JoinCleanupService", () => {
  it("expires pending requests for a listing and emits JOIN_FAILED", async () => {
    const { service, fanout, rows } = setup();
    rows.push(
      {
        id: "jr-1",
        listingId: "l1",
        requesterAccountId: "acc-1",
        status: "PENDING",
      },
      {
        id: "jr-2",
        listingId: "l1",
        requesterAccountId: "acc-1",
        status: "ACCEPTED",
      }
    );

    await service.closePendingForListing("l1", "LISTING_EXPIRED");

    expect(rows[0].status).toBe("EXPIRED");
    expect(rows[1].status).toBe("ACCEPTED");
    expect(fanout.emitToUser).toHaveBeenCalledWith(
      "user-1",
      SocketEvents.JOIN_FAILED,
      { joinRequestId: "jr-1", code: "LISTING_EXPIRED" }
    );
    expect(fanout.emitToUser).toHaveBeenCalledTimes(1);
  });

  it("expires a user's other pending requests and skips the accepted one", async () => {
    const { service, fanout, rows } = setup();
    rows.push(
      {
        id: "keep",
        listingId: "l1",
        requesterAccountId: "acc-1",
        status: "PENDING",
      },
      {
        id: "other",
        listingId: "l2",
        requesterAccountId: "acc-1",
        status: "PENDING",
      }
    );

    await service.closePendingForRequester(
      "user-1",
      "ACCEPTED_ELSEWHERE",
      "keep"
    );

    expect(rows.find((r) => r.id === "keep")?.status).toBe("PENDING");
    expect(rows.find((r) => r.id === "other")?.status).toBe("EXPIRED");
    expect(fanout.emitToUser).toHaveBeenCalledWith(
      "user-1",
      SocketEvents.JOIN_FAILED,
      { joinRequestId: "other", code: "ACCEPTED_ELSEWHERE" }
    );
  });

  it("listens for listing.closed", async () => {
    const { service } = setup();
    const spy = jest
      .spyOn(service, "closePendingForListing")
      .mockResolvedValue(undefined);
    await service.onListingClosed({ listingId: "l9", code: "DELISTED" });
    expect(spy).toHaveBeenCalledWith("l9", "DELISTED");
  });
});
