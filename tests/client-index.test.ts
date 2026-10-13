/**
 * Client ride loop with faked natives: entities taken from the server's net ids (#310), Space held without blocking
 * the loop, board put away when downed and at a character change (#313), E to get on / off and the ox_target option
 * to pick the board up with hrp-interact held off meanwhile (PRODUCTION-SERVER#414). src/client/index.ts is bundled
 * like scripts/build.js does and run in a VM context whose globals are the fakes; game time runs SPEED× faster than
 * real time so the animations' waits stay short.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { CONTROL } from '@common/skate';
import { buildSync } from 'esbuild';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const SPEED = 20;
const PED = 1;
const IDS = { vehicle: 101, board: 102, driver: 103 };
const ENTITY = { vehicle: 1101, board: 1102, driver: 1103 };
const PICKUP_TARGET = 'hrp-skating:pickup';

interface TargetOption {
  name: string;
  label: string;
  distance: number;
  canInteract: () => boolean;
  onSelect: () => void;
}

const realSetTimeout = setTimeout;
const t0 = performance.now();
const gameTime = () => Math.floor((performance.now() - t0) * SPEED);

const handlers = new Map<string, (...args: unknown[]) => void>();
const pressed = new Set<number>();
const justReleased = new Set<number>();
const alive = new Set<number>([PED, ENTITY.vehicle, ENTITY.board, ENTITY.driver]);
const controlled = new Set<number>();
const localPlayer = { state: {} as Record<string, unknown> };

const natives: Record<string, unknown> = {
  PlayerPedId: () => PED,
  GetGameTimer: gameTime,
  NetworkDoesNetworkIdExist: () => true,
  NetworkGetEntityFromNetworkId: (netId: number) => netId + 1000,
  DoesEntityExist: (entity: number) => alive.has(entity),
  NetworkHasControlOfEntity: (entity: number) => controlled.has(entity),
  NetworkRequestControlOfEntity: (entity: number) => controlled.add(entity),
  IsPedInVehicle: () => true,
  GetEntityCoords: () => [0, 0, 0],
  GetEntitySpeed: () => 0,
  GetEntityRotation: () => [0, 0, 0],
  GetEntityVelocity: () => [1, 2, 3],
  IsEntityInAir: () => false,
  IsControlPressed: (_group: number, control: number) => pressed.has(control),
  IsControlJustPressed: () => false,
  GetResourceState: () => 'started',
  IsControlJustReleased: (_group: number, control: number) => justReleased.delete(control),
  HasEntityCollidedWithAnything: () => false,
  IsPedDeadOrDying: () => false,
  IsPedRagdoll: () => false,
  DoesAnimDictExist: () => true,
  HasAnimDictLoaded: () => true,
  IsModelValid: () => true,
  HasModelLoaded: () => true,
  GetHashKey: (name: string) => name.length,
};

const g: Record<string, unknown> = {
  setTimeout: (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => realSetTimeout(fn, ms / SPEED, ...args),
  setTick: (fn: () => void) => setInterval(fn, 1),
  clearTick: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  console,
  IsDuplicityVersion: () => false,
  GetCurrentResourceName: () => 'hrp-skating',
  GetGameName: () => 'fivem',
  LoadResourceFile: (_resource: string, path: string) => readFileSync(path, 'utf8'),
  LocalPlayer: localPlayer,
  exports: {
    ox_lib: { notify: vi.fn(), getLocaleKey: () => 'en', cache: () => false },
    ox_target: { addLocalEntity: vi.fn(), removeLocalEntity: vi.fn() },
    'hrp-interact': { suspend: vi.fn(), resume: vi.fn() },
  },
  on: (name: string, fn: (...args: unknown[]) => void) => handlers.set(name, fn),
  onNet: (name: string, fn: (...args: unknown[]) => void) => handlers.set(name, fn),
  emitNet: vi.fn(),
  AddEventHandler: vi.fn(),
  // Not stubbed: src/common/log.ts falls back to its console logger
  HrpLog: undefined,
  HrpTrace: undefined,
};

let bundle = '';

/** A spy for every native the bundle names (ox_lib passes some by reference), `natives` above for their values. */
function stubNatives(code: string): void {
  for (const name of new Set(code.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [])) {
    if (name in g || name in globalThis) continue;
    const impl = natives[name];
    g[name] = vi.fn(typeof impl === 'function' ? (impl as (...args: unknown[]) => unknown) : () => 0);
  }
}

const spy = (name: string) => g[name] as ReturnType<typeof vi.fn>;
const exportSpy = (resource: string, name: string) =>
  (g.exports as Record<string, Record<string, ReturnType<typeof vi.fn>>>)[resource][name];
/** The « Ramasser la planche » option last offered to ox_target. */
const pickupOption = (): TargetOption => {
  const calls = exportSpy('ox_target', 'addLocalEntity').mock.calls;
  const [entity, options] = calls[calls.length - 1] as [number, TargetOption[]];
  expect(entity).toBe(ENTITY.board);
  const option = options.find((o) => o.name === PICKUP_TARGET);
  if (!option) throw new Error('no pickup option on the board');
  return option;
};
const fire = (name: string, ...args: unknown[]) => handlers.get(name)?.(...args);

async function waitUntil(cond: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (!cond()) {
    if (performance.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => realSetTimeout(resolve, 2));
  }
}
const waitGame = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms / SPEED));
const gaveBack = () =>
  spy('emitNet').mock.calls.some(([event]) => event === 'astudios-skating:server:giveItem');

beforeAll(() => {
  bundle = buildSync({
    entryPoints: ['src/client/index.ts'],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: ['es2021'],
    dropLabels: ['$BROWSER', '$DEV', '$SERVER'],
  }).outputFiles[0].text;
  stubNatives(bundle);
  runInNewContext(bundle, g);
});

/** Starts a ride from the server's net ids and gets on the board. */
async function startAndMount(): Promise<void> {
  spy('emitNet').mockClear();
  spy('AttachEntityToEntity').mockClear();
  spy('PlaceObjectOnGroundProperly').mockClear();
  for (const name of ['suspend', 'resume']) exportSpy('hrp-interact', name).mockClear();
  for (const name of ['addLocalEntity', 'removeLocalEntity']) exportSpy('ox_target', name).mockClear();
  fire('astudios-skating:client:start', IDS);
  await waitUntil(() => spy('PlaceObjectOnGroundProperly').mock.calls.length > 0, 'board put down');
  justReleased.add(CONTROL.mount);
  await waitUntil(
    () => spy('AttachEntityToEntity').mock.calls.some(([e, to]) => e === PED && to === ENTITY.vehicle),
    'rider on the board',
  );
}

describe('hrp-skating client', () => {
  it('never creates a networked entity itself (#310, sv_entityLockdown)', () => {
    expect(bundle).not.toMatch(/\bCreate(Vehicle|Object|Ped)\w*\(/);
    expect(bundle).not.toMatch(/\bDelete(Entity|Vehicle|Object|Ped)\(/);
  });

  it('ignores a start without valid net ids', async () => {
    fire('astudios-skating:client:start', { name: 'skateboard' });
    await waitGame(100);
    expect(spy('NetworkGetEntityFromNetworkId')).not.toHaveBeenCalled();
  });

  it('takes the server entities, sets them up once and attaches the board to the BMX root bone', async () => {
    await startAndMount();
    expect(spy('NetworkGetEntityFromNetworkId').mock.calls.map(([id]) => id)).toEqual([101, 102, 103]);
    expect([...controlled].sort()).toEqual([ENTITY.vehicle, ENTITY.board, ENTITY.driver]);
    expect(spy('AttachEntityToEntity')).toHaveBeenCalledWith(
      ENTITY.board,
      ENTITY.vehicle,
      0,
      ...[0, 0, -0.4, 0, 0, 90, false, true, true, true, 1, true],
    );
    await waitGame(200); // many loop turns
    // Set up once (Skateboard.fromNetIds), not on every loop turn
    expect(spy('SetEntityInvincible')).toHaveBeenCalledTimes(2);
    expect(spy('ForceVehicleEngineAudio')).toHaveBeenCalledTimes(1);
    expect(spy('StopCurrentPlayingAmbientSpeech')).toHaveBeenCalledTimes(1);
  });

  it('keeps riding while Space is held, jumps at the release', async () => {
    const drives = () => spy('TaskVehicleTempAction').mock.calls.length;
    const collisions = () => spy('HasEntityCollidedWithAnything').mock.calls.length;
    pressed.add(CONTROL.jump);
    await waitGame(50);
    const [d0, c0] = [drives(), collisions()];
    await waitGame(400); // held: more than the 250 ms of a full jump
    // Loop turns are counted, not timed: a busy machine (a deploy building every resource) runs fewer turns in 400 ms.
    await waitUntil(() => drives() - d0 > 5 && collisions() - c0 > 5, 'loop kept driving and checking falls');
    expect(spy('SetEntityVelocity')).not.toHaveBeenCalled();

    pressed.delete(CONTROL.jump);
    await waitUntil(() => spy('SetEntityVelocity').mock.calls.length > 0, 'jump');
    expect(spy('SetEntityVelocity')).toHaveBeenCalledWith(ENTITY.vehicle, 1, 2, 8); // full boost: 3 + 5
  });

  it('puts the board away when the rider is downed (hrp-life-and-death state)', async () => {
    localPlayer.state.isDowned = true;
    await waitUntil(gaveBack, 'item asked back');
    expect(spy('DetachEntity')).toHaveBeenCalledWith(PED, false, false);
    expect(exportSpy('hrp-interact', 'resume')).toHaveBeenCalledWith('board');
    expect(exportSpy('ox_target', 'removeLocalEntity')).toHaveBeenCalledWith(ENTITY.board, PICKUP_TARGET);
    localPlayer.state.isDowned = false;
  });

  it('puts the board away at a character change', async () => {
    await startAndMount();
    expect(gaveBack()).toBe(false);
    fire('ox:playerLogout');
    await waitUntil(gaveBack, 'item asked back');
    expect(exportSpy('hrp-interact', 'resume')).toHaveBeenCalledWith('board');
  });

  it('gets on with E (38), never G (#414), and holds hrp-interact off while the board is out', async () => {
    expect(CONTROL.mount).toBe(38);
    expect(bundle).not.toMatch(/\bIsControl(Just)?(Pressed|Released)\(0, (113|47)\)/);
    await startAndMount();
    expect(exportSpy('hrp-interact', 'suspend')).toHaveBeenCalledWith('board');
    expect(exportSpy('hrp-interact', 'resume')).not.toHaveBeenCalled();
    // E again: off the board
    spy('DetachEntity').mockClear();
    justReleased.add(CONTROL.mount);
    await waitUntil(() => spy('DetachEntity').mock.calls.some(([e]) => e === PED), 'rider off the board');
    expect(gaveBack()).toBe(false);
  });

  it('offers « Ramasser la planche » on the board prop through ox_target, not while riding', async () => {
    const option = pickupOption();
    expect(option.label).toBe('Ramasser la planche'); // static/config.json locale: fr
    expect(option.distance).toBe(1.5);
    expect(option.canInteract()).toBe(true); // off the board (previous test)
    justReleased.add(CONTROL.mount);
    await waitUntil(() => !option.canInteract(), 'no pickup while riding');
    justReleased.add(CONTROL.mount);
    await waitUntil(() => option.canInteract(), 'pickup offered again once off');
  });

  it('picks the board up from the ox_target option: item back, option removed, hrp-interact resumed', async () => {
    const option = pickupOption();
    spy('AttachEntityToEntity').mockClear();
    option.onSelect();
    expect(option.canInteract()).toBe(false); // chosen once
    await waitUntil(gaveBack, 'item asked back');
    // The pickup animation holds the board in the hand before letting it go
    expect(spy('AttachEntityToEntity')).toHaveBeenCalledWith(
      ENTITY.vehicle,
      PED,
      expect.anything(),
      ...[-0.1, 0, -0.2, 70, 0, 270, true, true, false, false, 2, true],
    );
    expect(exportSpy('ox_target', 'removeLocalEntity')).toHaveBeenCalledWith(ENTITY.board, PICKUP_TARGET);
    expect(exportSpy('hrp-interact', 'resume')).toHaveBeenCalledWith('board');
  });

  it('resumes hrp-interact and drops the target option when the resource stops with a board out', async () => {
    await startAndMount();
    fire('onResourceStop', 'hrp-skating');
    expect(exportSpy('ox_target', 'removeLocalEntity')).toHaveBeenCalledWith(ENTITY.board, PICKUP_TARGET);
    expect(exportSpy('hrp-interact', 'resume')).toHaveBeenCalledWith('board');
    await waitUntil(gaveBack, 'ride loop ended');
  });
});
