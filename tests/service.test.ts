import { log } from '@common/log';
import { describe, expect, it, vi } from 'vitest';
import type { BoardEntities } from '../src/server/entities';
import { type BoardInventory, type BoardWorld, type PendingBoards, SkatingService } from '../src/server/service';

function setup(removes = true) {
  let nextEntity = 100;
  let spawns = true;
  const world = {
    spawn: vi.fn<BoardWorld['spawn']>(async () => {
      if (!spawns) return null;
      nextEntity += 3;
      return { vehicle: nextEntity, board: nextEntity + 1, driver: nextEntity + 2 };
    }),
    netIds: vi.fn<BoardWorld['netIds']>((e: BoardEntities) => ({
      vehicle: e.vehicle * 10,
      board: e.board * 10,
      driver: e.driver * 10,
    })),
    despawn: vi.fn<BoardWorld['despawn']>(),
  };
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
    world,
    spawnFails: () => {
      spawns = false;
    },
    owed,
    info,
    warn,
    inventoryAccepts: (value: boolean) => {
      adds = value;
    },
    service: new SkatingService(inventory, pending, world, logger),
  };
}

describe('SkatingService', () => {
  it('takes the board out once, creates its entities and returns their net ids', async () => {
    const { inventory, world, info, service } = setup();
    expect(await service.useItem(1, 3, 10)).toEqual({ vehicle: 1030, board: 1040, driver: 1050 });
    expect(inventory.removeBoard).toHaveBeenCalledWith(1, 3);
    expect(world.spawn).toHaveBeenCalledWith(1);
    expect(info).toHaveBeenCalledWith('skateboard placed', { source: 1, charId: 10 });
    expect(await service.useItem(1, 4, 10)).toBeNull();
    expect(inventory.removeBoard).toHaveBeenCalledTimes(1);
    expect(world.spawn).toHaveBeenCalledTimes(1);
  });

  it('does not deploy a board the inventory refused to remove, nor without a character', async () => {
    const { inventory, world, info, service } = setup(false);
    expect(await service.useItem(1, 3, 10)).toBeNull();
    expect(await service.useItem(2, 3, null)).toBeNull();
    expect(inventory.removeBoard).toHaveBeenCalledTimes(1);
    expect(world.spawn).not.toHaveBeenCalled();
    expect(service.isDeployed(1) || service.isDeployed(2)).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('gives the item back when the entities could not be created (#310)', async () => {
    const { inventory, world, spawnFails, service } = setup();
    spawnFails();
    expect(await service.useItem(1, 3, 10)).toBeNull();
    expect(inventory.addBoard).toHaveBeenCalledWith(1);
    expect(service.isDeployed(1)).toBe(false);
    expect(world.despawn).not.toHaveBeenCalled();
  });

  it('deletes the entities created for a player who logged out meanwhile (#310)', async () => {
    const { inventory, world, service } = setup();
    const using = service.useItem(1, 3, 10);
    service.returnOnLogout(1); // ox:playerLogout while the server was creating the entities
    expect(await using).toBeNull();
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(world.despawn).toHaveBeenCalledWith({ vehicle: 103, board: 104, driver: 105 });
  });

  it('gives the board back once, only to a player who has one out, and deletes its entities (#310)', async () => {
    const { inventory, world, info, service } = setup();
    service.giveItem(1);
    expect(inventory.addBoard).not.toHaveBeenCalled();

    await service.useItem(1, 3, 10);
    service.giveItem(1);
    service.giveItem(1);
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(world.despawn).toHaveBeenCalledTimes(1);
    expect(world.despawn).toHaveBeenCalledWith({ vehicle: 103, board: 104, driver: 105 });
    expect(info).toHaveBeenLastCalledWith('skateboard picked up', { source: 1, charId: 10 });
  });

  it('returns the board at logout, once, while the inventory is still loaded, and deletes its entities', async () => {
    const { inventory, world, owed, service } = setup();
    await service.useItem(1, 3, 10);
    service.returnOnLogout(1);
    service.returnOnLogout(1); // playerDropped after ox:playerLogout
    service.giveItem(1); // the client's late giveItem
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(world.despawn).toHaveBeenCalledTimes(1);
    expect(owed.size).toBe(0);
  });

  it('owes the board to its character when the inventory is gone, and gives it at its next login', async () => {
    const { inventory, owed, warn, inventoryAccepts, service } = setup();
    await service.useItem(1, 3, 10);
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

  it('returns every board out on resource stop and deletes every entity', async () => {
    const { inventory, world, service } = setup();
    await service.useItem(1, 3, 10);
    await service.useItem(2, 5, 20);
    service.returnAll();
    expect(inventory.addBoard.mock.calls).toEqual([[1], [2]]);
    expect(world.despawn).toHaveBeenCalledTimes(2);
    expect(service.isDeployed(1) || service.isDeployed(2)).toBe(false);
  });
});
