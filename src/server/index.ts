/**
 * hrp-skating server — composition root: the `skateboard` item (ox_inventory `server.export`
 * `hrp-skating.useSkateboardItem`) and the board's way back into the inventory.
 */

import Config from '@common/config';
import { EVENT } from '@common/events';
import { log } from '@common/log';
import { DRIVER_MODEL, MODEL_NAME } from '@common/skate';
import { BoardSpawner, type EntityNatives } from './entities';
import { type BoardInventory, type PendingBoards, SkatingService } from './service';

/** Lua exports returning several values (`false, 'reason'`) reach JS as an array. */
function succeeded(result: unknown): boolean {
  return result === true || (Array.isArray(result) && result[0] === true);
}

const inventory: BoardInventory = {
  removeBoard: (src, slot) => succeeded(exports.ox_inventory.RemoveItem(src, Config.itemName, 1, undefined, slot)),
  addBoard: (src) => succeeded(exports.ox_inventory.AddItem(src, Config.itemName, 1)),
};

/** Boards owed per character, in the resource KVP (survives a restart). */
const pending: PendingBoards = {
  get: (charId) => GetResourceKvpInt(`owed:${charId}`),
  set: (charId, count) => {
    if (count > 0) SetResourceKvpInt(`owed:${charId}`, count);
    else DeleteResourceKvp(`owed:${charId}`);
  },
};

/** Ped type given to the invisible driver (as in the original CreatePed). */
const DRIVER_PED_TYPE = 12;
/** Orphan mode 0: the server deletes the entity once no longer relevant (owner gone) — a leftover never stays. */
const DELETE_WHEN_NOT_RELEVANT = 0;

/**
 * Server natives behind the board's entities (#310: sv_entityLockdown refuses network entities created by client
 * scripts). CreateVehicleServerSetter is the reliable server vehicle creation (no RPC to a client).
 */
const natives: EntityNatives = {
  pedOf: (src) => GetPlayerPed(String(src)),
  coords: (entity) => GetEntityCoords(entity),
  heading: (entity) => GetEntityHeading(entity),
  createVehicle: (x, y, z, heading) =>
    CreateVehicleServerSetter(GetHashKey(MODEL_NAME.vehicle), 'bike', x, y, z, heading),
  createBoard: (x, y, z) => CreateObjectNoOffset(GetHashKey(MODEL_NAME.board), x, y, z, true, true, false),
  createDriver: (vehicle) => CreatePedInsideVehicle(vehicle, DRIVER_PED_TYPE, DRIVER_MODEL, -1, true, false),
  exists: (entity) => entity !== 0 && DoesEntityExist(entity),
  owner: (entity) => NetworkGetEntityOwner(entity),
  netId: (entity) => NetworkGetNetworkIdFromEntity(entity),
  prepare: (entity) => {
    SetEntityOrphanMode(entity, DELETE_WHEN_NOT_RELEVANT);
    // The rider takes control of all three (drives the BMX, attaches the board): never filtered out
    SetEntityIgnoreRequestControlFilter(entity, true);
  },
  remove: (entity) => DeleteEntity(entity),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const service = new SkatingService(inventory, pending, new BoardSpawner(natives), log);

const oxCoreStarted = () => GetResourceState('ox_core') === 'started';

/** charId of the player's active character, or null. */
function activeCharId(src: number): number | null {
  if (!oxCoreStarted()) return null;
  const player = exports.ox_core.GetPlayer(src) as { charId?: unknown } | undefined;
  return typeof player?.charId === 'number' ? player.charId : null;
}

/** ox_inventory loads the player inventory on ox:playerLoaded too (with a database read): retry a few times. */
const DELIVER_TRIES = 10;
const DELIVER_DELAY_MS = 1000;

async function deliverPending(src: number, charId: number): Promise<void> {
  for (let attempt = 0; attempt < DELIVER_TRIES; attempt++) {
    if (activeCharId(src) !== charId) return;
    if (service.deliverPending(src, charId) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, DELIVER_DELAY_MS));
  }
  log.business.warn('skateboard still owed after the login retries', { source: src, charId });
}

function deliverLater(src: number, charId: number): void {
  deliverPending(src, charId).catch((err) => log.error(err instanceof Error ? err : String(err)));
}

interface InventoryRef {
  id?: unknown;
}

/**
 * ox_inventory calls it as (event, item, inventory, slot, data); with `consume = 0` only 'usingItem' is sent.
 * Returning false cancels ox_inventory's own use flow: the board is taken out of the slot by the service, its entities
 * created by the server, then the client puts it down.
 */
exports(
  'useSkateboardItem',
  (event: string, _item: unknown, inv: InventoryRef | undefined, slot: number | undefined) => {
    if (event !== 'usingItem') return;
    const src = inv?.id;
    if (typeof src === 'number') {
      service
        .useItem(src, slot, activeCharId(src))
        .then((netIds) => {
          if (netIds) emitNet(EVENT.start, src, netIds);
        })
        .catch((err) => log.error(err instanceof Error ? err : String(err)));
    }
    return false;
  },
);

onNet(EVENT.giveItem, () => {
  service.giveItem(source);
});

// Character change or disconnection (crash, timeout): the board goes back to the character that took it out, never to
// the next one. ox_core emits ox:playerLogout from its own playerDropped handler; whichever comes first returns it.
on('ox:playerLogout', (src: number) => {
  service.returnOnLogout(Number(src));
});

on('playerDropped', () => {
  service.returnOnLogout(source);
});

on('ox:playerLoaded', (src: number, _userId: number, charId: number) => {
  if (typeof charId === 'number') deliverLater(Number(src), charId);
});

on('onResourceStart', (resource: string) => {
  if (resource !== GetCurrentResourceName() || !oxCoreStarted()) return;
  const players = exports.ox_core.GetPlayers() as { source?: unknown; charId?: unknown }[] | undefined;
  for (const player of players ?? []) {
    if (typeof player.charId === 'number') deliverLater(Number(player.source), player.charId);
  }
});

on('onResourceStop', (resource: string) => {
  if (resource !== GetCurrentResourceName()) return;
  service.returnAll();
});

log.debug('started');
