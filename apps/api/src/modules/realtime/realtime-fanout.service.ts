import { Injectable } from "@nestjs/common";
import { SocketEvents, type ListingStatePayload } from "@lobly/shared-types";
import { SyncGateway } from "./sync.gateway";

@Injectable()
export class RealtimeFanoutService {
  private gateway: SyncGateway | null = null;

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
