# hrp-skating

Skateboard for Héritage RP — a fork of [astudios-skating](https://github.com/apx-studios/astudios-skating) (Apex
Studios), ported to TypeScript on [`hrp-typescript-template`](https://github.com/Heritage-RP/hrp-typescript-template)
(Heritage-RP/PRODUCTION-SERVER#223).

Use the `skateboard` item: the board is put down in front of you. <kbd>G</kbd> gets on / off, <kbd>W</kbd> <kbd>A</kbd>
<kbd>S</kbd> <kbd>D</kbd> ride, <kbd>Space</kbd> jumps (held longer = higher), <kbd>E</kbd> picks the board up (back
in the inventory). A dead owner's board is put away automatically.

## How it works

- **Server** (`src/server/`): `useSkateboardItem` export, called by ox_inventory (`server.export` of the item, `consume
  = 0`) — takes the board out of the slot, **creates the board's networked entities** (`entities.ts`: BMX by
  `CreateVehicleServerSetter`, board prop, driver by `CreatePedInsideVehicle`; it waits until each has an owner) and
  sends their net ids to the client. Client scripts never create network entities, so the resource works with
  `sv_entityLockdown relaxed` (PRODUCTION-SERVER#310). The item comes back (and the server deletes the entities) only
  for a player who has a board out, once: picked up, character change (`ox:playerLogout`), disconnection or crash (owed
  to the character, KVP `owed:<charId>`, given at its next login), resource stop.
- **Client** (`src/client/`): takes control of the three entities, makes the BMX and its driver invisible, attaches
  the board prop under the BMX and drives it (`TASK_VEHICLE_TEMP_ACTION`). Space is read once per loop turn
  (`JumpTracker`), never awaited.
- **Common** (`src/common/skate.ts`): controls → driving action, jump, fall rules, spawn point — unit-tested.
- **Tests** (`tests/`): pure rules, `SkatingService`, `BoardSpawner`, and both composition roots (`src/server/index.ts`,
  `src/client/index.ts`) bundled with esbuild and run in a VM with faked natives.

Net events (names of the original): `astudios-skating:client:start` (payload: `{ vehicle, board, driver }` net ids),
`astudios-skating:server:giveItem`.
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
