/**
 * Server composition root with faked FiveM globals: the item export, the events that give the board back
 * (ox:playerLogout, playerDropped, onResourceStop, ox:playerLoaded) and the entities created/deleted by the server
 * (#310 — sv_entityLockdown). src/server/index.ts is bundled like scripts/build.js does and run in a VM context whose
 * globals are the fakes below (FiveM's `exports` is a global; vitest shadows it inside its own modules).
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => void>();
const registered = new Map<string, (...args: unknown[]) => unknown>();
const kvp = new Map<string, number>();
const alive = new Set<number>();
let nextEntity = 300;
const charIds = new Map<number, number>();
let inventoryLoaded = true;

const g: Record<string, unknown> = {};
const ox_inventory = {
  RemoveItem: vi.fn(() => true),
  AddItem: vi.fn(() => (inventoryLoaded ? true : [false, 'invalid_inventory'])),
};
const ox_core = {
  GetPlayer: vi.fn((src: number) => (charIds.has(src) ? { charId: charIds.get(src) } : undefined)),
  GetPlayers: vi.fn(() => [...charIds].map(([source, charId]) => ({ source, charId }))),
};
const created = () => {
  nextEntity += 1;
  alive.add(nextEntity);
  return nextEntity;
};

Object.assign(g, {
  exports: Object.assign(
    vi.fn((name: string, fn: (...args: unknown[]) => unknown) => registered.set(name, fn)),
    { ox_inventory, ox_core },
  ),
  on: vi.fn((name: string, fn: (...args: unknown[]) => void) => handlers.set(name, fn)),
  onNet: vi.fn((name: string, fn: (...args: unknown[]) => void) => handlers.set(name, fn)),
  emitNet: vi.fn(),
  source: 0,
  setTimeout,
  console,
  IsDuplicityVersion: () => true,
  LoadResourceFile: (_resource: string, path: string) => readFileSync(path, 'utf8'),
  GetCurrentResourceName: () => 'hrp-skating',
  GetResourceState: () => 'started',
  GetResourceKvpInt: (key: string) => kvp.get(key) ?? 0,
  SetResourceKvpInt: (key: string, value: number) => kvp.set(key, value),
  DeleteResourceKvp: (key: string) => kvp.delete(key),
  GetHashKey: (name: string) => name.length,
  GetPlayerPed: vi.fn(() => 42),
  GetEntityCoords: () => [0, 0, 10],
  GetEntityHeading: () => 0,
  CreateVehicleServerSetter: vi.fn(created),
  CreateObjectNoOffset: vi.fn(created),
  CreatePedInsideVehicle: vi.fn(created),
  DoesEntityExist: (entity: number) => entity === 42 || alive.has(entity),
  NetworkGetEntityOwner: () => 1,
  NetworkGetNetworkIdFromEntity: (entity: number) => entity * 2,
  SetEntityOrphanMode: vi.fn(),
  SetEntityIgnoreRequestControlFilter: vi.fn(),
  DeleteEntity: vi.fn((entity: number) => alive.delete(entity)),
});

const fire = (name: string, ...args: unknown[]) => {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no handler for ${name}`);
  handler(...args);
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Uses the item as player `src` and waits for the server to create the entities. */
async function useBoard(src: number) {
  const result = registered.get('useSkateboardItem')?.('usingItem', { name: 'skateboard' }, { id: src }, 3);
  await flush();
  return result;
}

beforeAll(() => {
  const bundle = buildSync({
    entryPoints: ['src/server/index.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    dropLabels: ['$BROWSER', '$DEV', '$CLIENT'],
  });
  runInNewContext(bundle.outputFiles[0].text, g);
});

beforeEach(() => {
  vi.clearAllMocks();
  alive.clear();
  kvp.clear();
  charIds.clear();
  inventoryLoaded = true;
});

describe('hrp-skating server', () => {
  it('takes the board out, creates its entities on the server and sends their net ids (#310)', async () => {
    charIds.set(1, 10);
    expect(await useBoard(1)).toBe(false); // ox_inventory's own flow cancelled
    expect(ox_inventory.RemoveItem).toHaveBeenCalledWith(1, 'skateboard', 1, undefined, 3);
    expect(g.CreateVehicleServerSetter).toHaveBeenCalledWith(3, 'bike', expect.any(Number), 2, 10, 0);
    expect(g.CreatePedInsideVehicle).toHaveBeenCalledWith(alive.values().next().value, 12, 68070371, -1, true, false);
    expect(g.SetEntityIgnoreRequestControlFilter).toHaveBeenCalledTimes(3);
    const [vehicle, board, driver] = [...alive];
    expect(g.emitNet).toHaveBeenCalledWith('astudios-skating:client:start', 1, {
      vehicle: vehicle * 2,
      board: board * 2,
      driver: driver * 2,
    });
    fire('ox:playerLogout', 1);
  });

  it('does nothing without a character', async () => {
    expect(await useBoard(5)).toBe(false);
    expect(ox_inventory.RemoveItem).not.toHaveBeenCalled();
    expect(g.CreateVehicleServerSetter).not.toHaveBeenCalled();
    expect(g.emitNet).not.toHaveBeenCalled();
  });

  it('character change: the board goes back to the character leaving and its entities are deleted', async () => {
    charIds.set(1, 10);
    await useBoard(1);
    expect(alive.size).toBe(3);
    fire('ox:playerLogout', 1);
    expect(ox_inventory.AddItem).toHaveBeenCalledWith(1, 'skateboard', 1);
    expect(alive.size).toBe(0);
    // The next character picks the board up: nothing more is given
    charIds.set(1, 11);
    g.source = 1;
    fire('astudios-skating:server:giveItem');
    expect(ox_inventory.AddItem).toHaveBeenCalledTimes(1);
  });

  it('crash / disconnection: the board is owed to the character and given at its next login', async () => {
    charIds.set(2, 20);
    await useBoard(2);
    inventoryLoaded = false; // ox_inventory already dropped the inventory
    g.source = 2;
    fire('playerDropped');
    expect(alive.size).toBe(0);
    expect(kvp.get('owed:20')).toBe(1);

    inventoryLoaded = true;
    charIds.set(9, 20);
    fire('ox:playerLoaded', 9, 1, 20);
    await flush();
    expect(ox_inventory.AddItem).toHaveBeenLastCalledWith(9, 'skateboard', 1);
    expect(kvp.has('owed:20')).toBe(false);
  });

  it('picked up: the item comes back once and the entities are deleted', async () => {
    charIds.set(3, 30);
    await useBoard(3);
    g.source = 3;
    fire('astudios-skating:server:giveItem');
    fire('astudios-skating:server:giveItem');
    expect(ox_inventory.AddItem).toHaveBeenCalledTimes(1);
    expect(g.DeleteEntity).toHaveBeenCalledTimes(3);
    expect(alive.size).toBe(0);
  });

  it('resource stop: every board goes back and every entity is deleted', async () => {
    charIds.set(1, 10);
    charIds.set(2, 20);
    await useBoard(1);
    await useBoard(2);
    expect(alive.size).toBe(6);
    fire('onResourceStop', 'other-resource');
    expect(alive.size).toBe(6);
    fire('onResourceStop', 'hrp-skating');
    expect(ox_inventory.AddItem).toHaveBeenCalledTimes(2);
    expect(alive.size).toBe(0);
  });
});
