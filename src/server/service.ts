import type { Logger } from '@common/log';

/** Inventory operations on the skateboard item (ox_inventory in game, a fake in tests). */
export interface BoardInventory {
  /** Takes one board out of `slot`; true only when it was actually removed. */
  removeBoard(src: number, slot: number | undefined): boolean;
  /** Puts one board in the player's inventory; false when it could not (inventory unloaded, full). */
  addBoard(src: number): boolean;
}

/**
 * Boards owed to a character that could not get them back at once (it logged out or crashed with its board out, or its
 * inventory refused it), given at its next login. Persisted (resource KVP in game), so a restart keeps them.
 */
export interface PendingBoards {
  get(charId: number): number;
  set(charId: number, count: number): void;
}

/**
 * Who has a board out of their inventory — one at a time, owned by the character that took it out. The client can't
 * create skateboards: the server only gives one back to a player it took one from, once, and to that character only.
 */
export class SkatingService {
  /** source → charId of the character whose board is out. */
  private readonly deployed = new Map<number, number>();

  constructor(
    private readonly inventory: BoardInventory,
    private readonly pending: PendingBoards,
    private readonly log: Logger,
  ) {}

  /** The board was used from the inventory: take it out and tell the client to put it down. */
  useItem(src: number, slot: number | undefined, charId: number | null): boolean {
    if (charId === null || this.deployed.has(src)) return false;
    if (!this.inventory.removeBoard(src, slot)) return false;
    this.deployed.set(src, charId);
    this.log.business.info('skateboard placed', { source: src, charId });
    return true;
  }

  /** The board was picked up (or vanished): give it back to a player who has one out. */
  giveItem(src: number): void {
    this.giveBack(src, 'skateboard picked up');
  }

  /**
   * The character logged out or the player left (crash, timeout): the board goes back to the character that took it
   * out — into its inventory if ox_inventory still has it loaded, otherwise at its next login.
   */
  returnOnLogout(src: number): void {
    this.giveBack(src, 'skateboard returned on logout');
  }

  /** Resource stop: every board out goes back to its owner's inventory. */
  returnAll(): void {
    for (const src of [...this.deployed.keys()]) this.giveBack(src, 'skateboard returned on resource stop');
  }

  /**
   * Gives `src` (now playing `charId`) the boards it is owed. Returns how many are still owed: its inventory may not
   * be loaded yet right after the login (the caller tries again).
   */
  deliverPending(src: number, charId: number): number {
    let owed = this.pending.get(charId);
    if (owed <= 0) return 0;
    while (owed > 0 && this.inventory.addBoard(src)) {
      owed -= 1;
      this.log.business.info('skateboard owed given back', { source: src, charId });
    }
    this.pending.set(charId, owed);
    return owed;
  }

  isDeployed(src: number): boolean {
    return this.deployed.has(src);
  }

  private giveBack(src: number, message: string): void {
    const charId = this.deployed.get(src);
    if (charId === undefined) return;
    this.deployed.delete(src);
    if (this.inventory.addBoard(src)) {
      this.log.business.info(message, { source: src, charId });
      return;
    }
    this.pending.set(charId, this.pending.get(charId) + 1);
    this.log.business.warn('skateboard owed to its character (inventory unavailable)', { source: src, charId });
  }
}
