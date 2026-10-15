export const JOIN_QUEUE = "join-timeouts";

/** ListingsService emits this when a listing is no longer joinable. */
export const LISTING_CLOSED_EVENT = "listing.closed";

export interface ListingClosedEvent {
  listingId: string;
  code: string;
}
