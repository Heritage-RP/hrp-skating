/**
 * Optional neighbour resources, used only when started: ox_target carries « Ramasser la planche » (Alt on the board
 * prop — the BMX under it is invisible and has no collision, so a raycast never hits it) and hrp-interact is asked to
 * hold its own [E] prompts off while the board is out, since E gets on / off the board (PRODUCTION-SERVER#414).
 */

/** Name of the ox_target option on the board. */
export const PICKUP_TARGET = 'hrp-skating:pickup';
/** Reason given to hrp-interact's `suspend` / `resume`. */
const INTERACT_REASON = 'board';

const started = (resource: string): boolean => GetResourceState(resource) === 'started';

export interface PickupTarget {
  label: string;
  distance: number;
  canInteract: () => boolean;
  onSelect: () => void;
}

/** Offers « Ramasser la planche » on `entity` (the board prop). */
export function addPickupTarget(entity: number, target: PickupTarget): void {
  if (!started('ox_target')) return;
  exports.ox_target.addLocalEntity(entity, [
    {
      name: PICKUP_TARGET,
      icon: 'fa-solid fa-hand',
      label: target.label,
      distance: target.distance,
      canInteract: target.canInteract,
      onSelect: target.onSelect,
    },
  ]);
}

export function removePickupTarget(entity: number): void {
  if (!started('ox_target')) return;
  exports.ox_target.removeLocalEntity(entity, PICKUP_TARGET);
}

/** Holds hrp-interact's quick interactions off (`true`) or lets them back (`false`). */
export function holdInteract(hold: boolean): void {
  if (!started('hrp-interact')) return;
  if (hold) exports['hrp-interact'].suspend(INTERACT_REASON);
  else exports['hrp-interact'].resume(INTERACT_REASON);
}
