import { log } from '@common/log';
import { describe, expect, it, vi } from 'vitest';
import { type BoardInventory, SkatingService } from '../src/server/service';

function setup(removes = true) {
  const inventory = {
    removeBoard: vi.fn<BoardInventory['removeBoard']>(() => removes),
    addBoard: vi.fn<BoardInventory['addBoard']>(),
  };
  const info = vi.fn();
  const logger = { ...log, business: { ...log.business, info } } as typeof log;
  return { inventory, info, service: new SkatingService(inventory, logger) };
}

describe('SkatingService', () => {
  it('takes the board out once and logs it', () => {
    const { inventory, info, service } = setup();
    expect(service.useItem(1, 3)).toBe(true);
    expect(inventory.removeBoard).toHaveBeenCalledWith(1, 3);
    expect(info).toHaveBeenCalledWith('skateboard placed', { source: 1 });
    expect(service.useItem(1, 4)).toBe(false);
    expect(inventory.removeBoard).toHaveBeenCalledTimes(1);
  });

  it('does not deploy a board the inventory refused to remove', () => {
    const { info, service } = setup(false);
    expect(service.useItem(1, 3)).toBe(false);
    expect(service.isDeployed(1)).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('gives the board back once, only to a player who has one out', () => {
    const { inventory, info, service } = setup();
    service.giveItem(1);
    expect(inventory.addBoard).not.toHaveBeenCalled();

    service.useItem(1, 3);
    service.giveItem(1);
    service.giveItem(1);
    expect(inventory.addBoard).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith('skateboard picked up', { source: 1 });
  });

  it('forgets the board of a player who left', () => {
    const { inventory, service } = setup();
    service.useItem(1, 3);
    service.forget(1);
    service.giveItem(1);
    expect(inventory.addBoard).not.toHaveBeenCalled();
  });

  it('returns every board out on resource stop', () => {
    const { inventory, service } = setup();
    service.useItem(1, 3);
    service.useItem(2, 5);
    service.returnAll();
    expect(inventory.addBoard.mock.calls).toEqual([[1], [2]]);
    expect(service.isDeployed(1) || service.isDeployed(2)).toBe(false);
  });
});
