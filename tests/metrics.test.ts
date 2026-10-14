import { log } from '@heritage-rp/lib/log';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardEntities, SpawnResult } from '../src/server/entities';
import { skatingMetrics } from '../src/server/metrics';
import { type BoardInventory, type BoardWorld, type PendingBoards, SkatingService } from '../src/server/service';

type Call = [method: string, name: string, labels: Record<string, string>, value: number];

/** Every value the `result` / `reason` labels may take: anything else is a bug (or a player id leaking). */
const VALUES = new Set([
  'ok',
  'ignored',
  'no_player',
  'no_character',
  'duplicate',
  'not_removed',
  'no_entities',
  'left',
  'failed',
  'owed',
  'no_board',
  'none',
  'retry',
  'gave_up',
  'ped',
  'vehicle',
  'board',
  'driver',
  'pickup',
  'logout',
  'dropped',
  'stop',
]);

/** hrp-metrics as the lib sees it: `GetResourceState` says started, every export records its call. */
function stubMetrics(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('GetResourceState', () => 'started');
  vi.stubGlobal('exports', {
    'hrp-metrics': new Proxy({}, { get: (_t, key) => (...args: unknown[]) => calls.push([String(key), ...args] as Call) }),
  });
  return calls;
}

const increments = (calls: Call[]) => calls.filter(([method]) => method === 'incrementCounter');
const labelsOf = (calls: Call[], name: string) => increments(calls).filter((c) => c[1] === name).map((c) => c[2]);

function setup() {
  let nextEntity = 100;
  let spawn: SpawnResult | null = null;
  const world: BoardWorld = {
    spawn: async () => {
      if (spawn) return spawn;
      nextEntity += 3;
      return { ok: true, entities: { vehicle: nextEntity, board: nextEntity + 1, driver: nextEntity + 2 } };
    },
    netIds: (e: BoardEntities) => ({ vehicle: e.vehicle * 10, board: e.board * 10, driver: e.driver * 10 }),
    despawn: () => undefined,
  };
  let removes = true;
  let adds = true;
  const inventory: BoardInventory = {
    removeBoard: () => removes,
    addBoard: () => adds,
  };
  const owed = new Map<number, number>();
  const pending: PendingBoards = {
    get: (charId) => owed.get(charId) ?? 0,
    set: (charId, count) => {
      if (count > 0) owed.set(charId, count);
      else owed.delete(charId);
    },
  };
  const quiet = { ...log, business: { ...log.business, info: () => undefined, warn: () => undefined } } as typeof log;
  return {
    service: new SkatingService(inventory, pending, world, quiet),
    spawnFails: (result: SpawnResult) => {
      spawn = result;
    },
    inventoryRemoves: (value: boolean) => {
      removes = value;
    },
    inventoryAccepts: (value: boolean) => {
      adds = value;
    },
    owed,
  };
}

describe('metrics', () => {
  let calls: Call[];
  beforeEach(() => {
    calls = stubMetrics();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('publishes a use with its result, a return with its trigger', () => {
    skatingMetrics.use('ignored');
    skatingMetrics.return('dropped', 'no_board');
    expect(increments(calls)).toEqual([
      ['incrementCounter', 'hrp_skating_uses_total', { result: 'ignored' }, 1],
      ['incrementCounter', 'hrp_skating_returns_total', { trigger: 'dropped', result: 'no_board' }, 1],
    ]);
  });

  it('a board put down counts its creation; picked up, its return and removal', async () => {
    const { service } = setup();
    expect(await service.useItem(1, 3, 10)).not.toBeNull();
    expect(labelsOf(calls, 'hrp_skating_uses_total')).toEqual([{ result: 'ok' }]);
    expect(labelsOf(calls, 'hrp_skating_boards_created_total')).toEqual([{ result: 'ok' }]);

    service.giveItem(1);
    expect(labelsOf(calls, 'hrp_skating_boards_removed_total')).toEqual([{ reason: 'pickup' }]);
    expect(labelsOf(calls, 'hrp_skating_returns_total')).toEqual([{ trigger: 'pickup', result: 'ok' }]);
  });

  it('refusals say why: no character, a board already out, an item the inventory kept', async () => {
    const { service, inventoryRemoves } = setup();
    expect(await service.useItem(1, 3, null)).toBeNull();
    expect(await service.useItem(1, 3, 10)).not.toBeNull();
    expect(await service.useItem(1, 3, 10)).toBeNull();
    inventoryRemoves(false);
    expect(await service.useItem(2, 3, 20)).toBeNull();
    expect(labelsOf(calls, 'hrp_skating_uses_total')).toEqual([
      { result: 'no_character' },
      { result: 'ok' },
      { result: 'duplicate' },
      { result: 'not_removed' },
    ]);
  });

  it('entities that could not be created name the failed stage, and the return is not counted twice', async () => {
    const { service, spawnFails } = setup();
    spawnFails({ ok: false, failed: 'driver' });
    expect(await service.useItem(1, 3, 10)).toBeNull();
    expect(labelsOf(calls, 'hrp_skating_boards_created_total')).toEqual([{ result: 'driver' }]);
    expect(labelsOf(calls, 'hrp_skating_uses_total')).toEqual([{ result: 'no_entities' }]);
    expect(labelsOf(calls, 'hrp_skating_returns_total')).toEqual([]);
    expect(labelsOf(calls, 'hrp_skating_boards_removed_total')).toEqual([]);
  });

  it('logout then drop: the first return gives the board back, the second finds nothing', async () => {
    const { service } = setup();
    await service.useItem(1, 3, 10);
    service.returnOnLogout(1, 'logout');
    service.returnOnLogout(1, 'dropped');
    expect(labelsOf(calls, 'hrp_skating_returns_total')).toEqual([
      { trigger: 'logout', result: 'ok' },
      { trigger: 'dropped', result: 'no_board' },
    ]);
    expect(labelsOf(calls, 'hrp_skating_boards_removed_total')).toEqual([{ reason: 'logout' }]);
  });

  it('a board owed at logout, then delivered: owed, none, retry, ok', async () => {
    const { service, inventoryAccepts, owed } = setup();
    await service.useItem(1, 3, 10);
    inventoryAccepts(false);
    service.returnAll();
    expect(owed.get(10)).toBe(1);
    expect(service.deliverPending(4, 11)).toBe(0);
    expect(service.deliverPending(4, 10)).toBe(1);
    inventoryAccepts(true);
    expect(service.deliverPending(4, 10)).toBe(0);
    expect(labelsOf(calls, 'hrp_skating_returns_total')).toEqual([{ trigger: 'stop', result: 'owed' }]);
    expect(labelsOf(calls, 'hrp_skating_deliveries_total')).toEqual([
      { result: 'none' },
      { result: 'retry' },
      { result: 'ok' },
    ]);
  });

  it('never publishes a value outside the known ones', async () => {
    const { service, spawnFails, inventoryAccepts } = setup();
    await service.useItem(1, 3, 10);
    await service.useItem(1, 3, 10);
    spawnFails({ ok: false, failed: 'ped' });
    await service.useItem(2, 3, 20);
    service.giveItem(3);
    inventoryAccepts(false);
    service.returnOnLogout(1, 'dropped');
    service.deliverPending(5, 10);
    const values = increments(calls).map(([, , labels]) => labels.result ?? labels.reason);
    expect(values.length).toBeGreaterThan(5);
    for (const value of values) expect(VALUES.has(value), value).toBe(true);
    for (const [, , labels] of increments(calls)) if (labels.trigger) expect(VALUES.has(labels.trigger)).toBe(true);
  });

  it('does nothing without hrp-metrics', () => {
    vi.unstubAllGlobals();
    expect(() => skatingMetrics.boardRemoved('stop')).not.toThrow();
  });
});
