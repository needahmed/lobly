export var ListingStatus;
(function (ListingStatus) {
    ListingStatus["DRAFT"] = "DRAFT";
    ListingStatus["LISTED"] = "LISTED";
    ListingStatus["FILLING"] = "FILLING";
    ListingStatus["READY"] = "READY";
    ListingStatus["PAUSED"] = "PAUSED";
    ListingStatus["IN_SESSION"] = "IN_SESSION";
    ListingStatus["POST_SESSION"] = "POST_SESSION";
    ListingStatus["DELISTED"] = "DELISTED";
})(ListingStatus || (ListingStatus = {}));
export const ACTIVE_LISTING_STATUSES = [
    ListingStatus.LISTED,
    ListingStatus.FILLING,
    ListingStatus.READY,
    ListingStatus.PAUSED,
];
