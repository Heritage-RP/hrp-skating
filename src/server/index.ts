/**
 * hrp-skating server — composition root: the `skateboard` item (ox_inventory `server.export`
 * `hrp-skating.useSkateboardItem`) and the board's way back into the inventory.
 */

import Config from '@common/config';
import { EVENT } from '@common/events';
import { log } from '@common/log';
import { type BoardInventory, SkatingService } from './service';

/** Lua exports returning several values (`false, 'reason'`) reach JS as an array. */
function succeeded(result: unknown): boolean {
  return result === true || (Array.isArray(result) && result[0] === true);
}

const inventory: BoardInventory = {
  removeBoard: (src, slot) => succeeded(exports.ox_inventory.RemoveItem(src, Config.itemName, 1, undefined, slot)),
  addBoard: (src) => {
    exports.ox_inventory.AddItem(src, Config.itemName, 1);
  },
};

const service = new SkatingService(inventory, log);

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
    if (typeof src === 'number' && service.useItem(src, slot)) emitNet(EVENT.start, src, item);
    return false;
  },
);

onNet(EVENT.giveItem, () => {
  service.giveItem(source);
});

on('playerDropped', () => {
  service.forget(source);
});

on('onResourceStop', (resource: string) => {
  if (resource !== GetCurrentResourceName()) return;
  service.returnAll();
});

log.debug('started');
