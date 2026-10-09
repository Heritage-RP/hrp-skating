import type { Logger } from '@common/log';

/** Inventory operations on the skateboard item (ox_inventory in game, a fake in tests). */
export interface BoardInventory {
  /** Takes one board out of `slot`; true only when it was actually removed. */
  removeBoard(src: number, slot: number | undefined): boolean;
  addBoard(src: number): void;
}

/**
 * Who has a board out of their inventory — one at a time. The client can't create skateboards: the server only gives
 * one back to a player it took one from, once.
 */
export class SkatingService {
  private readonly deployed = new Set<number>();

  constructor(
    private readonly inventory: BoardInventory,
    private readonly log: Logger,
  ) {}

  /** The board was used from the inventory: take it out and tell the client to put it down. */
  useItem(src: number, slot: number | undefined): boolean {
    if (this.deployed.has(src)) return false;
    if (!this.inventory.removeBoard(src, slot)) return false;
    this.deployed.add(src);
    this.log.business.info('skateboard placed', { source: src });
    return true;
  }

  /** The board was picked up (or vanished): give it back to a player who has one out. */
  giveItem(src: number): void {
    if (!this.deployed.delete(src)) return;
    this.inventory.addBoard(src);
    this.log.business.info('skateboard picked up', { source: src });
  }

  /** The player left: the board is lost with them (no inventory to put it back into). */
  forget(src: number): void {
    this.deployed.delete(src);
  }

  /** Resource stop: every board out goes back to its owner's inventory. */
  returnAll(): void {
    for (const src of [...this.deployed]) this.giveItem(src);
  }

  isDeployed(src: number): boolean {
    return this.deployed.has(src);
  }
}
