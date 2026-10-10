import { isBoardNetIds } from '@common/events';
import { ACTION, JumpTracker, driveOrder, inFront, isRiderDown, jumpBoost, kmh, shouldFall } from '@common/skate';
import { describe, expect, it } from 'vitest';

const keys = (forward = false, backward = false, left = false, right = false) => ({ forward, backward, left, right });

describe('driveOrder', () => {
  it('does nothing without keys or above the speed cap', () => {
    expect(driveOrder(keys(), false)).toBeNull();
    expect(driveOrder(keys(true), true)).toBeNull();
  });

  it('handbrakes when forward and backward are held together', () => {
    expect(driveOrder(keys(true, true, true), false)).toEqual({ action: ACTION.handbrake, time: 100 });
  });

  it('maps the held keys to a temp action', () => {
    expect(driveOrder(keys(true), false)).toEqual({ action: ACTION.forward, time: 1 });
    expect(driveOrder(keys(true, false, true), false)?.action).toBe(ACTION.forwardLeft);
    expect(driveOrder(keys(true, false, false, true), false)?.action).toBe(ACTION.forwardRight);
    expect(driveOrder(keys(false, true), false)?.action).toBe(ACTION.backward);
    expect(driveOrder(keys(false, true, true), false)?.action).toBe(ACTION.backwardLeft);
    expect(driveOrder(keys(false, true, false, true), false)?.action).toBe(ACTION.backwardRight);
    expect(driveOrder(keys(false, false, true), false)?.action).toBe(ACTION.turnLeft);
    expect(driveOrder(keys(false, false, false, true), false)?.action).toBe(ACTION.turnRight);
  });

  it('prefers left when left and right are both held', () => {
    expect(driveOrder(keys(true, false, true, true), false)?.action).toBe(ACTION.forwardLeft);
  });
});

describe('jumpBoost', () => {
  it('grows with the time held and is capped at the max height', () => {
    expect(jumpBoost(0, 5)).toBe(0);
    expect(jumpBoost(125, 5)).toBe(2.5);
    expect(jumpBoost(250, 5)).toBe(5);
    expect(jumpBoost(2000, 5)).toBe(5);
  });
});

describe('shouldFall', () => {
  const riding = { pitch: 0, boardInAir: false, speed: 20, riderCollided: false, riderDead: false };

  it('keeps a normal ride going', () => {
    expect(shouldFall(riding)).toBe(false);
  });

  it('falls when the board flips in the air while slow', () => {
    expect(shouldFall({ ...riding, pitch: 70, boardInAir: true, speed: 3 })).toBe(true);
    expect(shouldFall({ ...riding, pitch: -70, boardInAir: true, speed: 3 })).toBe(true);
    expect(shouldFall({ ...riding, pitch: 70, boardInAir: true, speed: 10 })).toBe(false);
    expect(shouldFall({ ...riding, pitch: 70, boardInAir: false, speed: 3 })).toBe(false);
  });

  it('falls on a hit only above 5 km/h', () => {
    expect(shouldFall({ ...riding, riderCollided: true })).toBe(true);
    expect(shouldFall({ ...riding, riderCollided: true, speed: 4 })).toBe(false);
  });

  it('falls when the rider dies', () => {
    expect(shouldFall({ ...riding, riderDead: true })).toBe(true);
  });
});

describe('kmh', () => {
  it('converts m/s', () => {
    expect(kmh(10)).toBe(36);
  });
});

describe('JumpTracker (Space held no longer blocks the ride loop)', () => {
  it('crouches at the press, answers at once every frame while held, jumps at the release', () => {
    const jump = new JumpTracker(5);
    expect(jump.update(true, false, 1000)).toEqual({ kind: 'crouch' });
    // Held for 10 frames: each call returns at once with nothing to do — the loop keeps driving and checking falls
    for (let t = 1010; t < 1110; t += 10) expect(jump.update(true, false, t)).toBeNull();
    expect(jump.holding).toBe(true);
    expect(jump.update(false, false, 1125)).toEqual({ kind: 'jump', boost: 2.5 });
    expect(jump.holding).toBe(false);
  });

  it('caps the boost and cancels a release in the air', () => {
    const jump = new JumpTracker(5);
    jump.update(true, false, 0);
    expect(jump.update(false, false, 5000)).toEqual({ kind: 'jump', boost: 5 });
    jump.update(true, false, 6000);
    expect(jump.update(false, true, 6100)).toEqual({ kind: 'cancel' });
  });

  it('does not start a jump in the air, and forgets a press on reset', () => {
    const jump = new JumpTracker(5);
    expect(jump.update(true, true, 0)).toBeNull();
    expect(jump.update(true, false, 10)).toEqual({ kind: 'crouch' });
    jump.reset();
    expect(jump.update(false, false, 20)).toBeNull();
  });
});

describe('isRiderDown', () => {
  it('counts the hrp-life-and-death downed state, not only the death frame', () => {
    expect(isRiderDown(false, true)).toBe(true);
    expect(isRiderDown(true, undefined)).toBe(true);
    expect(isRiderDown(false, undefined)).toBe(false);
    expect(isRiderDown(false, 'true')).toBe(false);
  });
});

describe('inFront', () => {
  it('follows the GTA heading (0 north, counter-clockwise)', () => {
    const [nx, ny] = inFront(0, 0, 0, 2);
    expect([nx, ny].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 2]);
    const [ex, ey] = inFront(10, 10, 270, 2);
    expect(ex).toBeCloseTo(12);
    expect(ey).toBeCloseTo(10);
  });
});

describe('isBoardNetIds', () => {
  it('accepts three positive integer net ids only', () => {
    expect(isBoardNetIds({ vehicle: 1, board: 2, driver: 3 })).toBe(true);
    expect(isBoardNetIds({ vehicle: 1, board: 2 })).toBe(false);
    expect(isBoardNetIds({ vehicle: 1, board: 0, driver: 3 })).toBe(false);
    expect(isBoardNetIds({ vehicle: 1.5, board: 2, driver: 3 })).toBe(false);
    expect(isBoardNetIds(null)).toBe(false);
    expect(isBoardNetIds('item')).toBe(false);
  });
});
