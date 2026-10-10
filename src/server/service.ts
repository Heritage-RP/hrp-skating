import type { BoardNetIds } from '@common/events';
import type { Logger } from '@common/log';
import type { BoardEntities } from './entities';

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

/** The board's networked entities, created and deleted by the server (#310; `BoardSpawner` in game). */
export interface BoardWorld {
  /** null when the entities could not be created (nothing is left behind then). */
  spawn(src: number): Promise<BoardEntities | null>;
  netIds(entities: BoardEntities): BoardNetIds;
  despawn(entities: BoardEntities): void;
}

interface Deployed {
  charId: number;
  /** null while the entities are being created. */
  entities: BoardEntities | null;
}

/**
 * Who has a board out of their inventory — one at a time, owned by the character that took it out. The client can't
 * create skateboards: the server only gives one back to a player it took one from, once, and to that character only.
 */
export class SkatingService {
  /** source → the character whose board is out, and the board's entities. */
  private readonly deployed = new Map<number, Deployed>();

  constructor(
    private readonly inventory: BoardInventory,
    private readonly pending: PendingBoards,
    private readonly world: BoardWorld,
    private readonly log: Logger,
  ) {}

  /**
   * The board was used from the inventory: take it out and create its entities in front of the player. Returns their
   * net ids for the client to put the board down, or null (nothing taken, or the item given back when the entities
   * could not be created).
   */
  async useItem(src: number, slot: number | undefined, charId: number | null): Promise<BoardNetIds | null> {
    if (charId === null || this.deployed.has(src)) return null;
    if (!this.inventory.removeBoard(src, slot)) return null;
    const out: Deployed = { charId, entities: null };
    this.deployed.set(src, out);
    this.log.business.info('skateboard placed', { source: src, charId });

    const entities = await this.world.spawn(src);
    if (this.deployed.get(src) !== out) {
      // Given back while the entities were being created (logout, disconnection, resource stop)
      if (entities) this.world.despawn(entities);
      return null;
    }
    if (!entities) {
      this.log.warn('skateboard entities could not be created', { source: src, charId });
      this.giveBack(src, 'skateboard returned (entities not created)');
      return null;
    }
    out.entities = entities;
    return this.world.netIds(entities);
  }

  /** The board was picked up (or vanished): delete its entities and give it back to a player who has one out. */
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
    const out = this.deployed.get(src);
    if (out === undefined) return;
    this.deployed.delete(src);
    if (out.entities) this.world.despawn(out.entities);
    const { charId } = out;
    if (this.inventory.addBoard(src)) {
      this.log.business.info(message, { source: src, charId });
      return;
    }
    this.pending.set(charId, this.pending.get(charId) + 1);
    this.log.business.warn('skateboard owed to its character (inventory unavailable)', { source: src, charId });
  }
}
