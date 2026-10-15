export const QUEUE_NAMES = {
    400: "Normal Draft",
    420: "Ranked Solo/Duo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    490: "Quickplay",
    700: "Clash",
    720: "ARAM Clash",
    830: "Co-op vs AI",
    840: "Co-op vs AI",
    850: "Co-op vs AI",
    900: "ARURF",
    1020: "One for All",
    1700: "Arena",
    1900: "URF",
};
export function queueName(queueId) {
    return QUEUE_NAMES[queueId] ?? "Custom";
}
