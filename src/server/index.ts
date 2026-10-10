/**
 * hrp-skating server — composition root: the `skateboard` item (ox_inventory `server.export`
 * `hrp-skating.useSkateboardItem`) and the board's way back into the inventory.
 */

import Config from '@common/config';
import { EVENT } from '@common/events';
import { log } from '@common/log';
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

const service = new SkatingService(inventory, pending, log);

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
 * Returning false cancels ox_inventory's own use flow: the board has already been taken out of the slot.
 */
exports(
  'useSkateboardItem',
  (event: string, item: unknown, inv: InventoryRef | undefined, slot: number | undefined) => {
    if (event !== 'usingItem') return;
    const src = inv?.id;
    if (typeof src === 'number' && service.useItem(src, slot, activeCharId(src))) emitNet(EVENT.start, src, item);
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
