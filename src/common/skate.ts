/** Pure skateboard rules (no natives): what the client loop decides each frame, unit-tested. */

/** Control ids (https://docs.fivem.net/docs/game-references/controls/). */
export const CONTROL = {
  forward: 32, // INPUT_MOVE_UP_ONLY (W)
  backward: 33, // INPUT_MOVE_DOWN_ONLY (S)
  left: 34, // INPUT_MOVE_LEFT_ONLY (A)
  right: 35, // INPUT_MOVE_RIGHT_ONLY (D)
  pickup: 38, // INPUT_PICKUP (E)
  mount: 113, // INPUT_VEH_FLY_ATTACK_CAMERA (G)
  jump: 22, // INPUT_JUMP (Space)
} as const;

/** Models of the board's entities (names hashed with GetHashKey on each side). */
export const MODEL_NAME = {
  /** Invisible BMX that carries the physics (vehicles.meta type `bike`). */
  vehicle: 'bmx',
  /** The board prop (stream/p_defilied_ragdoll_01_s.ydr). */
  board: 'p_defilied_ragdoll_01_s',
} as const;
/** Invisible ped driving the BMX (model hash). */
export const DRIVER_MODEL = 68070371;

/** TASK_VEHICLE_TEMP_ACTION action codes given to the invisible driver. */
export const ACTION = {
  idle: 1,
  stop: 3,
  turnLeft: 4,
  turnRight: 5,
  brake: 6,
  forwardLeft: 7,
  forwardRight: 8,
  forward: 9,
  backwardLeft: 13,
  backwardRight: 14,
  backward: 22,
  handbrake: 30,
} as const;

export interface Movement {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export interface DriveOrder {
  action: number;
  time: number;
}

/** Temp action for the keys held this frame; null when none (or above the speed cap). */
export function driveOrder(movement: Movement, overSpeed: boolean): DriveOrder | null {
  if (overSpeed) return null;
  if (movement.forward && movement.backward) return { action: ACTION.handbrake, time: 100 };

  let action: number | null = null;
  if (movement.forward) {
    action = movement.left ? ACTION.forwardLeft : movement.right ? ACTION.forwardRight : ACTION.forward;
  } else if (movement.backward) {
    action = movement.left ? ACTION.backwardLeft : movement.right ? ACTION.backwardRight : ACTION.backward;
  } else if (movement.left) {
    action = ACTION.turnLeft;
  } else if (movement.right) {
    action = ACTION.turnRight;
  }
  return action === null ? null : { action, time: 1 };
}

/** Vertical boost of a jump: grows with the time the key was held (full height after 250 ms), capped. */
export function jumpBoost(heldMs: number, maxHeight: number): number {
  return Math.min((maxHeight * heldMs) / 250, maxHeight);
}

export interface RiderState {
  /** Board pitch (rotation X), degrees. */
  pitch: number;
  boardInAir: boolean;
  /** km/h */
  speed: number;
  riderCollided: boolean;
  riderDead: boolean;
}

/** Whether the rider falls off: board flipped in the air while slow, a hit while fast, or death. */
export function shouldFall(state: RiderState): boolean {
  if ((state.pitch < -60 || state.pitch > 60) && state.boardInAir && state.speed < 5) return true;
  if (state.riderCollided && state.speed > 5) return true;
  return state.riderDead;
}

/** m/s → km/h */
export function kmh(metersPerSecond: number): number {
  return metersPerSecond * 3.6;
}

/** Point `distance` m in front of a heading (GTA: degrees, 0 = north, counter-clockwise; forward = (-sin h, cos h)). */
export function inFront(x: number, y: number, heading: number, distance: number): [number, number] {
  const rad = (heading * Math.PI) / 180;
  return [x - Math.sin(rad) * distance, y + Math.cos(rad) * distance];
}

/** Dead, or downed by hrp-life-and-death (which resurrects the ped at once: the death itself may last one frame). */
export function isRiderDown(deadOrDying: boolean, downedState: unknown): boolean {
  return deadOrDying || downedState === true;
}

export type JumpStep = { kind: 'crouch' } | { kind: 'jump'; boost: number } | { kind: 'cancel' } | null;

/**
 * The jump key, one call per loop turn and never waited on: Space pressed on the ground → crouch; held → nothing (the
 * ride goes on); released → jump with a boost that grows with the time held, or cancel when the board is in the air.
 */
export class JumpTracker {
  private pressedAt: number | null = null;

  constructor(private readonly maxHeight: number) {}

  get holding(): boolean {
    return this.pressedAt !== null;
  }

  update(pressed: boolean, inAir: boolean, now: number): JumpStep {
    if (this.pressedAt === null) {
      if (!pressed || inAir) return null;
      this.pressedAt = now;
      return { kind: 'crouch' };
    }
    if (pressed) return null;

    const boost = jumpBoost(now - this.pressedAt, this.maxHeight);
    this.pressedAt = null;
    return inAir ? { kind: 'cancel' } : { kind: 'jump', boost };
  }

  reset(): void {
    this.pressedAt = null;
  }
}
