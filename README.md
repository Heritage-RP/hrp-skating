# hrp-skating

Skateboard for Héritage RP — a fork of [astudios-skating](https://github.com/apx-studios/astudios-skating) (Apex
Studios), ported to TypeScript on [`hrp-typescript-template`](https://github.com/Heritage-RP/hrp-typescript-template)
(Heritage-RP/PRODUCTION-SERVER#223).

Use the `skateboard` item: the board is put down in front of you. <kbd>G</kbd> gets on / off, <kbd>W</kbd> <kbd>A</kbd>
<kbd>S</kbd> <kbd>D</kbd> ride, <kbd>Space</kbd> jumps (held longer = higher), <kbd>E</kbd> picks the board up (back
in the inventory). A dead owner's board is put away automatically.

## How it works

- **Server** (`src/server/`): `useSkateboardItem` export, called by ox_inventory (`server.export` of the item, `consume
  = 0`) — takes the board out of the slot and tells the client to put it down. It gives the item back only to a player
  who has a board out, once (the client can't create skateboards). Boards out go back to their owners on resource stop;
  a player who leaves loses theirs.
- **Client** (`src/client/`): an invisible BMX driven by an invisible ped (`TASK_VEHICLE_TEMP_ACTION`) carries the board
  prop (`stream/p_defilied_ragdoll_01_s.ydr`).
- **Common** (`src/common/skate.ts`): controls → driving action, jump height, fall rules — unit-tested.

Net events (names of the original, unchanged): `astudios-skating:client:start`, `astudios-skating:server:giveItem`.
Business logs: `skateboard placed`, `skateboard picked up` (server, info), `got on the skateboard`, `got off the
skateboard`, `skateboard jump` (client, debug) — used by the hrp-bounty `skateboard` bounty.

## Configuration (`static/config.json`)

| Key | Default | |
|-----|---------|-|
| `locale` | `fr` | Language of the notification (`locales/`) |
| `itemName` | `skateboard` | ox_inventory item |
| `maxSpeedKmh` | `40` | Above it the keys no longer push the board |
| `maxJumpHeight` | `5` | Vertical boost of a full jump (key held 250 ms) |
| `loseConnectionDistance` | `2` | Beyond this distance (m) the board brakes and stops answering the keys |

The item (`hrp_inventory` `data/items.lua`):

```lua
['skateboard'] = { label = 'Skateboard', weight = 2000, stack = false, consume = 0,
	server = { export = 'hrp-skating.useSkateboardItem' } },
```

## Build

```bash
pnpm install && pnpm build   # dist/ + fxmanifest.lua (generated, not committed)
pnpm test                    # vitest
```

PRODUCTION-SERVER Devtools build it on update (`./Devtools/install.sh --build`).
