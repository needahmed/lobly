import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { SocketEvents, type ListingStatePayload } from "@lobly/shared-types";
import { RiotAccountsService } from "../identity/riot-accounts.service";
import { SyncGateway } from "./sync.gateway";

@Injectable()
export class RealtimeFanoutService {
  private gateway: SyncGateway | null = null;

  constructor(
    @Inject(forwardRef(() => RiotAccountsService))
    private readonly accounts: RiotAccountsService
  ) {}

  bind(gateway: SyncGateway) {
    this.gateway = gateway;
  }

  async emitBoardUpsert(
    platform: string,
    _queueId: number | undefined,
    row: unknown
  ): Promise<void> {
    this.gateway?.server
      .to(this.boardRoom(platform))
      .emit(SocketEvents.BOARD_DELTA, { upsert: row });
  }

  async emitBoardRemove(
    platform: string,
    _queueId: number | undefined,
    listingId: string
  ): Promise<void> {
    this.gateway?.server
      .to(this.boardRoom(platform))
      .emit(SocketEvents.BOARD_DELTA, { remove: listingId });
  }

  async emitListingState(
    creatorAccountId: string,
    payload: ListingStatePayload
  ): Promise<void> {
    this.gateway?.server
      .to(this.userRoomByAccount(creatorAccountId))
      .emit(SocketEvents.LISTING_STATE, payload);
  }

  async emitListingStateToUser(
    userId: string,
    payload: ListingStatePayload
  ): Promise<void> {
    this.gateway?.server
      .to(this.userRoom(userId))
      .emit(SocketEvents.LISTING_STATE, payload);
  }

  async emitToUser(userId: string, event: string, payload: unknown) {
    this.gateway?.server.to(this.userRoom(userId)).emit(event, payload);
  }

  async emitToSession(sessionId: string, event: string, payload: unknown) {
    this.gateway?.server.to(this.sessionRoom(sessionId)).emit(event, payload);
  }

  async joinSessionRoom(userId: string, sessionId: string) {
    if (!this.gateway?.server) return;
    const sockets = await this.gateway.server
      .in(this.userRoom(userId))
      .fetchSockets();
    for (const s of sockets) {
      await s.join(this.sessionRoom(sessionId));
    }
  }

  /**
   * Join account and board rooms for every Riot account linked to this user.
   * Covers accounts linked after the socket connected.
   */
  async joinAccountRooms(userId: string): Promise<void> {
    if (!this.gateway?.server) return;
    const sockets = await this.gateway.server
      .in(this.userRoom(userId))
      .fetchSockets();
    if (!sockets.length) return;
    const linked = await this.accounts.listMine(userId);
    for (const socket of sockets) {
      for (const account of linked) {
        await socket.join(this.userRoomByAccount(account.id));
        await socket.join(this.boardRoom(account.platform));
      }
    }
  }

  boardRoom(platform: string, _queueId?: number): string {
    return `board:${platform}`;
  }

  userRoom(userId: string): string {
    return `user:${userId}`;
  }

  userRoomByAccount(accountId: string): string {
    return `account:${accountId}`;
  }

  sessionRoom(sessionId: string): string {
    return `session:${sessionId}`;
  }
}
