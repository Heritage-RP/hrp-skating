import { log } from '@common/log';
import { describe, expect, it, vi } from 'vitest';
import { type BoardInventory, type PendingBoards, SkatingService } from '../src/server/service';

function setup(removes = true) {
  let adds = true;
  const inventory = {
    removeBoard: vi.fn<BoardInventory['removeBoard']>(() => removes),
    addBoard: vi.fn<BoardInventory['addBoard']>(() => adds),
  };
  const owed = new Map<number, number>();
  const pending: PendingBoards = {
    get: (charId) => owed.get(charId) ?? 0,
    set: (charId, count) => {
      if (count > 0) owed.set(charId, count);
      else owed.delete(charId);
    },
  };
  const info = vi.fn();
  const warn = vi.fn();
  const logger = { ...log, business: { ...log.business, info, warn } } as typeof log;
  return {
    inventory,
    owed,
    info,
    warn,
    inventoryAccepts: (value: boolean) => {
      adds = value;
    },
    service: new SkatingService(inventory, pending, logger),
  };
}

describe('SkatingService', () => {
  it('takes the board out once and logs it', () => {
    const { inventory, info, service } = setup();
    expect(service.useItem(1, 3, 10)).toBe(true);
    expect(inventory.removeBoard).toHaveBeenCalledWith(1, 3);
    expect(info).toHaveBeenCalledWith('skateboard placed', { source: 1, charId: 10 });
    expect(service.useItem(1, 4, 10)).toBe(false);
    expect(inventory.removeBoard).toHaveBeenCalledTimes(1);
  });

  it('does not deploy a board the inventory refused to remove, nor without a character', () => {
    const { inventory, info, service } = setup(false);
    expect(service.useItem(1, 3, 10)).toBe(false);
    expect(service.useItem(2, 3, null)).toBe(false);
    expect(inventory.removeBoard).toHaveBeenCalledTimes(1);
    expect(service.isDeployed(1) || service.isDeployed(2)).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('gives the board back once, only to a player who has one out', () => {
    const { inventory, info, service } = setup();
    service.giveItem(1);
    expect(inventory.addBoard).not.toHaveBeenCalled();

    service.useItem(1, 3, 10);
    service.giveItem(1);
    service.giveItem(1);
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith('skateboard picked up', { source: 1, charId: 10 });
  });

  it('returns the board at logout, once, while the inventory is still loaded', () => {
    const { inventory, owed, service } = setup();
    service.useItem(1, 3, 10);
    service.returnOnLogout(1);
    service.returnOnLogout(1); // playerDropped after ox:playerLogout
    service.giveItem(1); // the client's late giveItem
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(owed.size).toBe(0);
  });

  it('owes the board to its character when the inventory is gone, and gives it at its next login', () => {
    const { inventory, owed, warn, inventoryAccepts, service } = setup();
    service.useItem(1, 3, 10);
    inventoryAccepts(false);
    service.returnOnLogout(1);
    expect(owed.get(10)).toBe(1);
    expect(warn).toHaveBeenCalled();

    // Next login, inventory not loaded yet: still owed
    expect(service.deliverPending(4, 10)).toBe(1);
    inventoryAccepts(true);
    expect(service.deliverPending(4, 10)).toBe(0);
    expect(inventory.addBoard).toHaveBeenLastCalledWith(4);
    expect(owed.has(10)).toBe(false);
    // Another character is owed nothing
    expect(service.deliverPending(4, 11)).toBe(0);
  });

  it('returns every board out on resource stop', () => {
    const { inventory, service } = setup();
    service.useItem(1, 3, 10);
    service.useItem(2, 5, 20);
    service.returnAll();
    expect(inventory.addBoard.mock.calls).toEqual([[1], [2]]);
    expect(service.isDeployed(1) || service.isDeployed(2)).toBe(false);
  });
});
