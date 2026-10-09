import { ACTION, driveOrder, jumpBoost, kmh, shouldFall } from '@common/skate';
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
