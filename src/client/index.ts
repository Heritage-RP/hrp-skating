/**
 * hrp-skating client — the board put down in front of the player, ridden through an invisible BMX driven by an
 * invisible ped (TASK_VEHICLE_TEMP_ACTION), until it is picked up, lost or its owner dies.
 */

import Config from '@common/config';
import { EVENT } from '@common/events';
import Locale from '@common/locale';
import { log } from '@common/log';
import { ACTION, CONTROL, type Movement, driveOrder, jumpBoost, shouldFall } from '@common/skate';
import { initLocale, notify, requestAnimDict, requestModel, sleep } from '@communityox/ox_lib/client';
import { MODEL, Skateboard } from './board';

initLocale(Config.locale);

interface Anim {
  dict: string;
  name: string;
}

const ANIM = {
  pickup: { dict: 'pickup_object', name: 'pickup_low' },
  idle: { dict: 'move_strafe@stealth', name: 'idle' },
  crouch: { dict: 'move_crouch_proto', name: 'idle_intro' },
} satisfies Record<string, Anim>;

/** Distance (m) under which the board can be picked up or got on. */
const REACH = 1.5;

const MODELS = [MODEL.vehicle, MODEL.driver, MODEL.board];
const DICTS = [ANIM.pickup.dict, ANIM.idle.dict, ANIM.crouch.dict];

function playAnim(ped: number, anim: Anim, blendIn = 8, blendOut = -8, duration = -1, flag = 0, rate = 0): void {
  TaskPlayAnim(ped, anim.dict, anim.name, blendIn, blendOut, duration, flag, rate, false, false, false);
}

function stopAnim(ped: number, anim: Anim, blendOut = 1): void {
  StopAnimTask(ped, anim.dict, anim.name, blendOut);
}

function movement(): Movement {
  return {
    forward: IsControlPressed(0, CONTROL.forward),
    backward: IsControlPressed(0, CONTROL.backward),
    left: IsControlPressed(0, CONTROL.left),
    right: IsControlPressed(0, CONTROL.right),
  };
}

async function loadAssets(): Promise<void> {
  for (const model of MODELS) await requestModel(model);
  for (const dict of DICTS) await requestAnimDict(dict);
}

function unloadAssets(): void {
  for (const model of MODELS) SetModelAsNoLongerNeeded(model);
  for (const dict of DICTS) RemoveAnimDict(dict);
}

let board: Skateboard | null = null;
/** A ride is running (from the assets' loading until the item is given back). */
let busy = false;
let connected = false;
let player = 0;
/** Space held on the board: when it was pressed (game timer), or null. The jump is computed at the release. */
let jumpPressedAt: number | null = null;

/** Dead, or downed by hrp-life-and-death (which resurrects the ped at once: IsPedDeadOrDying may last a frame). */
function down(ped: number): boolean {
  return IsPedDeadOrDying(ped, true) || LocalPlayer.state.isDowned === true;
}

function connect(toggle: boolean): void {
  if (!board) return;
  if (toggle) {
    playAnim(player, ANIM.idle, 8, 8, -1, 1, 1);
    AttachEntityToEntity(player, board.vehicle, 20, 0, 0, 0.7, 0, 0, -15, true, true, false, true, 1, true);
    SetEntityCollision(player, true, true);
    log.business.debug('got on the skateboard');
  } else {
    jumpPressedAt = null;
    DetachEntity(player, false, false);
    stopAnim(player, ANIM.idle);
    stopAnim(PlayerPedId(), ANIM.crouch);
    board.drive(ACTION.stop, 1);
    if (connected) log.business.debug('got off the skateboard');
  }
  connected = toggle;
}

/** Deletes the board; the item comes back when the ride loop ends. */
function clear(): void {
  board?.destroy();
  board = null;
  unloadAssets();
  connected = false;
  jumpPressedAt = null;
  SetPedRagdollOnCollision(player, false);
}

async function putDown(current: Skateboard): Promise<void> {
  const ped = PlayerPedId();
  current.attachToHand(ped);
  playAnim(ped, ANIM.pickup);
  await sleep(800);
  DetachEntity(current.vehicle, false, true);
  PlaceObjectOnGroundProperly(current.vehicle);
  notify({ title: Locale('title'), description: Locale('controls'), type: 'inform' });
}

async function pickUp(current: Skateboard): Promise<void> {
  const ped = PlayerPedId();
  playAnim(ped, ANIM.pickup);
  await sleep(600);
  current.attachToHand(ped);
  await sleep(900);
  clear();
}

/**
 * Space held: crouch, then jump higher the longer it was held. Checked once per loop turn, never awaited: riding, the
 * speed cap and falls keep being evaluated while the key is held.
 */
function jump(current: Skateboard): void {
  if (!connected) return;
  const pressed = IsControlPressed(0, CONTROL.jump);

  if (jumpPressedAt === null) {
    if (!pressed || current.inAir()) return;
    jumpPressedAt = GetGameTimer();
    playAnim(PlayerPedId(), ANIM.crouch, 5, 8, -1, 0, 0);
    return;
  }
  if (pressed) return;

  const boost = jumpBoost(GetGameTimer() - jumpPressedAt, Config.maxJumpHeight);
  jumpPressedAt = null;
  stopAnim(PlayerPedId(), ANIM.crouch);
  if (current.inAir()) return;

  const [vx, vy, vz] = current.velocity();
  log.business.debug('skateboard jump', { height: boost });
  current.setVelocity(vx, vy, vz + boost);
  playAnim(player, ANIM.idle, 8, 2, -1, 1, 1);
}

async function handleKeys(current: Skateboard, distance: number): Promise<void> {
  if (distance <= REACH) {
    if (IsControlJustPressed(0, CONTROL.pickup)) {
      await pickUp(current);
      return;
    }
    if (IsControlJustReleased(0, CONTROL.mount)) {
      if (connected) connect(false);
      else if (!IsPedRagdoll(player)) {
        await sleep(200);
        if (board === current) connect(true);
      }
    }
  }

  if (distance >= Config.loseConnectionDistance || board !== current) return;

  const overSpeed = current.speed() > Config.maxSpeedKmh;
  current.drive(ACTION.idle, 1);
  player = PlayerPedId();

  if (connected) {
    const fall = shouldFall({
      pitch: current.pitch(),
      boardInAir: current.inAir(),
      speed: current.speed(),
      riderCollided: HasEntityCollidedWithAnything(player),
      riderDead: IsPedDeadOrDying(player, false) || LocalPlayer.state.isDowned === true,
    });
    if (fall) {
      connect(false);
      SetPedToRagdoll(player, 5000, 4000, 0, true, true, false);
    }
  }

  const order = driveOrder(movement(), overSpeed);
  if (order) current.drive(order.action, order.time);

  const released = IsControlJustReleased(0, CONTROL.forward) || IsControlJustReleased(0, CONTROL.backward);
  if (released && !overSpeed) current.drive(ACTION.brake, 2500);

  jump(current);
}

async function ride(current: Skateboard): Promise<void> {
  while (board === current && current.exists()) {
    await sleep(5);

    // Owner died or downed: put the board away (#29 — a dead owner could neither pick the board up nor take out
    // another one)
    if (down(PlayerPedId())) {
      player = PlayerPedId();
      if (connected) connect(false);
      clear();
      break;
    }

    const [px, py, pz] = GetEntityCoords(PlayerPedId(), false);
    const [bx, by, bz] = current.coords();
    const distance = Math.hypot(px - bx, py - by, pz - bz);

    await handleKeys(current, distance);
    if (board !== current) break;

    if (distance <= Config.loseConnectionDistance) current.requestControl();
    else current.drive(ACTION.brake, 2500);
  }
}

async function start(): Promise<void> {
  if (busy) return;
  busy = true;
  player = PlayerPedId();
  connected = false;

  try {
    await loadAssets();
    const ped = PlayerPedId();
    const [x, y, z] = GetEntityCoords(ped, false);
    const [fx, fy, fz] = GetEntityForwardVector(ped);
    const current = await Skateboard.create(x + fx * 2, y + fy * 2, z + fz * 2, GetEntityHeading(ped));
    board = current;
    await putDown(current);
    await ride(current);
  } catch (err) {
    log.error(err instanceof Error ? err : String(err));
  }

  // Picked up, or the board disappeared: clean up and get the item back (the server only gives it back to a player
  // who has a board out, once)
  if (board) clear();
  busy = false;
  emitNet(EVENT.giveItem);
}

onNet(EVENT.start, () => {
  start().catch((err) => log.error(err instanceof Error ? err : String(err)));
});

// Character change: the server gives the board back to the character leaving; the next one must not find it out.
on('ox:playerLogout', () => {
  if (!board) return;
  player = PlayerPedId();
  if (connected) connect(false);
  clear();
});

on('onResourceStop', (resource: string) => {
  if (resource !== GetCurrentResourceName() || !board) return;
  DetachEntity(PlayerPedId(), false, false);
  board.destroy();
  board = null;
});
