# hrp-skating

Skateboard for Héritage RP — a fork of [astudios-skating](https://github.com/apx-studios/astudios-skating) (Apex
Studios), ported to TypeScript on [`hrp-typescript-template`](https://github.com/Heritage-RP/hrp-typescript-template)
(Heritage-RP/PRODUCTION-SERVER#223).

Use the `skateboard` item: the board is put down in front of you. <kbd>E</kbd> near the board gets on / off,
<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> ride, <kbd>Space</kbd> jumps (held longer = higher); the board
is picked up (back in the inventory) through its ox_target option — <kbd>Alt</kbd> → « Ramasser la planche ». No
<kbd>G</kbd>: it is the Interface Portative's flashlight (PRODUCTION-SERVER#414). While the board is out, hrp-interact's
[E] prompts are held off (`suspend('board')` / `resume('board')`). A dead owner's board is put away automatically.

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
  (`JumpTracker`), never awaited. `neighbours.ts`: the ox_target option on the board prop (`hrp-skating:pickup`) and
  the hrp-interact suspension, both only when that resource is started.
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

## Metrics

Prometheus counters through hrp-metrics (`@heritage-rp/lib/metrics`, server only, `src/server/metrics.ts`), for the
useless-work audit of PRODUCTION-SERVER (`just waste`): `result="ok"` is work that served, any other value says why it
did not. Labels never carry a player, a character or free text. The resource has no server loop: nothing to count as
ticks (the client's ride loop is per frame, on the client).

| Counter | Labels | `result` / `reason` values |
|---------|--------|----------------------------|
| `hrp_skating_uses_total` | `result` | `ok` (board put down); `ignored` (ox_inventory event other than `usingItem`), `no_player`, `no_character`, `duplicate` (a board already out), `not_removed` (ox_inventory kept the item), `no_entities` (entities not created, item given back), `left` (player gone while the entities were created), `failed` (exception) |
| `hrp_skating_returns_total` | `trigger` (`pickup`, `logout`, `dropped`, `stop`), `result` | `ok` (back in the inventory); `owed` (inventory unavailable: given at the next login), `no_board` (nothing out — `ox:playerLogout` and `playerDropped` both fire, the second one finds nothing) |
| `hrp_skating_deliveries_total` | `result` | one per attempt at login: `ok` (owed boards given), `none` (nothing owed: the KVP was read for nothing), `retry` (inventory not loaded yet), `left` (character changed meanwhile), `gave_up` (still owed after the retries) |
| `hrp_skating_boards_created_total` | `result` | `ok`; the stage that failed: `ped` (player has no ped), `vehicle`, `board`, `driver`; `left` (created, but the player had gone: deleted at once) |
| `hrp_skating_boards_removed_total` | `reason` | `pickup`, `logout`, `dropped`, `stop` |

## Build

```bash
pnpm install && pnpm build   # dist/ + fxmanifest.lua (generated, not committed)
pnpm test                    # vitest
```

PRODUCTION-SERVER Devtools build it on update (`./Devtools/install.sh --build`).
