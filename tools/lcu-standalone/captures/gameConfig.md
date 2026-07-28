# LCU lobby gameConfig capture (2026-07-25)

## Solo/Duo queueId=420 (live)
- gameMode: CLASSIC
- mapId: 11
- maxLobbySize: 2
- maxTeamSize: 5
- showPositionSelector: true
- showQuickPlaySlotSelection: false
- isCustom: false
- isLobbyFull: false
- queueId: 420
- localMember.firstPositionPreference / secondPositionPreference present

## Expected fallbacks (not yet captured live)
| queueId | mode | maxLobbySize | positional | rankSource | duoRules |
|---------|------|--------------|------------|------------|----------|
| 420 | Solo/Duo | 2 | true | solo | true |
| 440 | Flex | 5 | true | flex | false |
| 450 | ARAM | 5 | false | null (rank optional) | false |
| 490 | Quickplay | 5 | false (uses showQuickPlaySlotSelection) | null | false |
| 700 | Clash | 5 | true | solo | false |
| 0 / custom | Custom | varies | false | null | false |
| rotating (Mayhem etc) | derive from gameConfig | maxLobbySize | showPositionSelector | null unless ranked | false |

Field names confirmed from live payload: maxLobbySize, showPositionSelector, isCustom, gameMode, mapId, queueId, isLobbyFull.
