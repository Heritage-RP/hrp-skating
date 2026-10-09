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
