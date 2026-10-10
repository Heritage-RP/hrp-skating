/**
 * The board's networked entities, created and deleted by the server (Heritage-RP/PRODUCTION-SERVER#310: with
 * `sv_entityLockdown relaxed` the server refuses network entities created by client scripts). The client only finds
 * them by net id, takes control and configures them locally (invisible, attached, driver seated).
 */

import type { BoardNetIds } from '@common/events';
import { inFront } from '@common/skate';

/** The three entities of a board out (server script handles). */
export interface BoardEntities {
  /** Invisible BMX carrying the physics. */
  vehicle: number;
  /** The board prop, attached under the BMX by the client. */
  board: number;
  /** Invisible ped driving the BMX (TASK_VEHICLE_TEMP_ACTION needs a driver). */
  driver: number;
}

/** Server natives used to spawn the board (FiveM in game, a fake in tests). */
export interface EntityNatives {
  /** The player's ped, 0 when none. */
  pedOf(src: number): number;
  coords(entity: number): number[];
  heading(entity: number): number;
  createVehicle(x: number, y: number, z: number, heading: number): number;
  createBoard(x: number, y: number, z: number): number;
  createDriver(vehicle: number): number;
  exists(entity: number): boolean;
  /** Owner's server id, -1 while no client owns it. */
  owner(entity: number): number;
  netId(entity: number): number;
  /** One-time setup once the entity exists (orphan mode, request-control filter). */
  prepare(entity: number): void;
  remove(entity: number): void;
  sleep(ms: number): Promise<void>;
}

/** Distance (m) in front of the player where the board appears. */
export const SPAWN_DISTANCE = 2;
/** How long an entity may take to exist and get an owner before the spawn is abandoned (ms). */
export const SPAWN_TIMEOUT_MS = 5000;
const POLL_MS = 50;

/** Creates the board's entities near a player and deletes them. */
export class BoardSpawner {
  constructor(private readonly natives: EntityNatives) {}

  /**
   * Creates the BMX, the board prop and the driver in front of `src`'s ped and waits until each exists and has an owner.
   * Returns null (nothing left behind) when the ped is missing or an entity never shows up.
   */
  async spawn(src: number): Promise<BoardEntities | null> {
    const n = this.natives;
    const ped = n.pedOf(src);
    if (ped === 0 || !n.exists(ped)) return null;

    const [px, py, pz] = n.coords(ped);
    const heading = n.heading(ped);
    const [x, y] = inFront(px, py, heading, SPAWN_DISTANCE);

    const created: number[] = [];
    const ready = async (entity: number): Promise<boolean> => {
      if (entity !== 0) created.push(entity);
      if (entity === 0 || !(await this.waitReady(entity))) return false;
      n.prepare(entity);
      return true;
    };

    const vehicle = n.createVehicle(x, y, pz, heading);
    if (await ready(vehicle)) {
      const board = n.createBoard(x, y, pz);
      if (await ready(board)) {
        const driver = n.createDriver(vehicle);
        if (await ready(driver)) return { vehicle, board, driver };
      }
    }

    for (const entity of created) this.remove(entity);
    return null;
  }

  netIds(entities: BoardEntities): BoardNetIds {
    return {
      vehicle: this.natives.netId(entities.vehicle),
      board: this.natives.netId(entities.board),
      driver: this.natives.netId(entities.driver),
    };
  }

  /** Deletes whatever is left of the board. */
  despawn(entities: BoardEntities): void {
    this.remove(entities.board);
    this.remove(entities.driver);
    this.remove(entities.vehicle);
  }

  private remove(entity: number): void {
    if (this.natives.exists(entity)) this.natives.remove(entity);
  }

  private async waitReady(entity: number): Promise<boolean> {
    for (let waited = 0; waited <= SPAWN_TIMEOUT_MS; waited += POLL_MS) {
      if (this.natives.exists(entity) && this.natives.owner(entity) !== -1) return true;
      await this.natives.sleep(POLL_MS);
    }
    return false;
  }
}
