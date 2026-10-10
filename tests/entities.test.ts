import { describe, expect, it, vi } from 'vitest';
import { BoardSpawner, type EntityNatives, SPAWN_TIMEOUT_MS } from '../src/server/entities';

/** Fake server world: entities exist and get an owner after `ownerAfter` polls (Infinity: never). */
function world(opts: { ped?: number; ownerAfter?: Partial<Record<'vehicle' | 'board' | 'driver', number>> } = {}) {
  const alive = new Set<number>();
  const polls = new Map<number, number>();
  const kinds = new Map<number, 'vehicle' | 'board' | 'driver'>();
  let next = 500;
  const create = (kind: 'vehicle' | 'board' | 'driver') => {
    next += 1;
    alive.add(next);
    kinds.set(next, kind);
    return next;
  };
  const natives = {
    pedOf: vi.fn(() => opts.ped ?? 42),
    coords: vi.fn(() => [100, 200, 30]),
    heading: vi.fn(() => 90),
    createVehicle: vi.fn<EntityNatives['createVehicle']>(() => create('vehicle')),
    createBoard: vi.fn<EntityNatives['createBoard']>(() => create('board')),
    createDriver: vi.fn<EntityNatives['createDriver']>(() => create('driver')),
    exists: vi.fn((entity: number) => entity === 42 || alive.has(entity)),
    owner: vi.fn((entity: number) => {
      const count = (polls.get(entity) ?? 0) + 1;
      polls.set(entity, count);
      const kind = kinds.get(entity);
      const after = kind ? (opts.ownerAfter?.[kind] ?? 0) : 0;
      return count > after ? 7 : -1;
    }),
    netId: vi.fn((entity: number) => entity + 1000),
    prepare: vi.fn<EntityNatives['prepare']>(),
    remove: vi.fn((entity: number) => {
      alive.delete(entity);
    }),
    sleep: vi.fn(async () => {}),
  } satisfies EntityNatives;
  return { natives, alive, spawner: new BoardSpawner(natives) };
}

describe('BoardSpawner (#310: board entities created by the server)', () => {
  it('creates the BMX, the board and its driver 2 m in front of the player, once each has an owner', async () => {
    const { natives, spawner } = world({ ownerAfter: { vehicle: 3 } });
    const entities = await spawner.spawn(1);
    expect(entities).toEqual({ vehicle: 501, board: 502, driver: 503 });
    // Heading 90 (west): 2 m towards -X
    const [x, y, z, heading] = natives.createVehicle.mock.calls[0];
    expect(x).toBeCloseTo(98);
    expect(y).toBeCloseTo(200);
    expect([z, heading]).toEqual([30, 90]);
    expect(natives.createDriver).toHaveBeenCalledWith(501);
    // Waited for the vehicle's owner before creating the rest
    expect(natives.sleep).toHaveBeenCalledTimes(3);
    expect(natives.prepare.mock.calls.map(([e]) => e)).toEqual([501, 502, 503]);
    expect(spawner.netIds(entities as NonNullable<typeof entities>)).toEqual({
      vehicle: 1501,
      board: 1502,
      driver: 1503,
    });
  });

  it('creates nothing without a ped', async () => {
    const { natives, spawner } = world({ ped: 0 });
    expect(await spawner.spawn(1)).toBeNull();
    expect(natives.createVehicle).not.toHaveBeenCalled();
  });

  it('deletes what it created when an entity never gets an owner', async () => {
    const { natives, alive, spawner } = world({ ownerAfter: { driver: Number.POSITIVE_INFINITY } });
    expect(await spawner.spawn(1)).toBeNull();
    expect(natives.sleep.mock.calls.length).toBeGreaterThanOrEqual(SPAWN_TIMEOUT_MS / 50);
    expect(natives.remove.mock.calls.map(([e]) => e).sort()).toEqual([501, 502, 503]);
    expect(alive.size).toBe(0);
  });

  it('stops at a failed creation and deletes the vehicle already made', async () => {
    const { natives, alive, spawner } = world();
    natives.createBoard.mockReturnValueOnce(0);
    expect(await spawner.spawn(1)).toBeNull();
    expect(natives.createDriver).not.toHaveBeenCalled();
    expect(natives.remove).toHaveBeenCalledWith(501);
    expect(alive.size).toBe(0);
  });

  it('despawn deletes the three entities, skipping those already gone', async () => {
    const { natives, spawner } = world();
    const entities = await spawner.spawn(1);
    if (!entities) throw new Error('not spawned');
    natives.remove(entities.driver); // the server already cleaned it up
    natives.remove.mockClear();
    spawner.despawn(entities);
    expect(natives.remove.mock.calls.map(([e]) => e)).toEqual([502, 501]);
  });
});
