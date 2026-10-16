/**
 * Metrics of hrp-skating (Prometheus, through hrp-metrics).
 *
 * Business metrics measure the game as players live it (boards out in the world, how long a board stays out) — no
 * `result` label, only what happened. Work counters serve the "useless work" audit of PRODUCTION-SERVER (`just waste`,
 * hrp-docs dev/travail-inutile.md): every recurring piece of server work is counted with its `result`, `ok` when it
 * served, otherwise why it did not. Label values are short, stable tokens from the code — never a player, a character
 * or free text.
 */

import { metrics } from '@heritage-rp/lib/metrics';
import type { SpawnStage } from './entities';

/** Where a board's way back into the inventory came from (work counters) — and how a session ended (business). */
export type ReturnTrigger = 'pickup' | 'logout' | 'dropped' | 'stop';

// ─── Métier (business) ───────────────────────────────────────────────────────

const boardsOut = metrics.gauge(
  'hrp_skating_boards_out',
  'Skateboards out in the world right now (entities created, not yet given back); set at every creation/removal and 0 at resource start',
);
const sessionSeconds = metrics.histogram(
  'hrp_skating_session_seconds',
  'How long a board stayed out, observed when it is taken back, by end (pickup, logout, dropped, stop)',
  ['end'],
  [30, 60, 120, 300, 600, 1800, 3600],
);

// ─── Work counters (waste) ───────────────────────────────────────────────────

/** `useSkateboardItem` (ox_inventory `server.export`): a board put down, or why not. */
export type UseResult =
  | 'ok'
  /** Another ox_inventory event than `usingItem` (`consume = 0` sends only that one). */
  | 'ignored'
  | 'no_player'
  | 'no_character'
  /** This player already has a board out. */
  | 'duplicate'
  /** ox_inventory refused to take the item out of the slot. */
  | 'not_removed'
  /** The entities could not be created: the item went back. */
  | 'no_entities'
  /** The player left while the entities were being created: they were deleted at once. */
  | 'left'
  | 'failed';

/** `owed`: inventory unavailable, given at the next login; `no_board`: the player had none out (nothing to do). */
export type ReturnResult = 'ok' | 'owed' | 'no_board';

/** Boards owed to a character, at its login: `none` = nothing owed (the KVP was read for nothing). */
export type DeliveryResult = 'ok' | 'none' | 'retry' | 'left' | 'gave_up';

/** A board's three entities: created, or the stage that failed, or created for a player who had already left. */
export type BoardCreatedResult = 'ok' | SpawnStage | 'left';

const uses = metrics.counter(
  'hrp_skating_uses_total',
  'Skateboard item uses by result (ok, ignored, no_player, no_character, duplicate, not_removed, no_entities, left, failed)',
  ['result'],
);
const returns = metrics.counter(
  'hrp_skating_returns_total',
  'Boards given back by trigger (pickup, logout, dropped, stop) and result (ok, owed, no_board = nothing out)',
  ['trigger', 'result'],
);
const deliveries = metrics.counter(
  'hrp_skating_deliveries_total',
  'Owed boards delivered at login, per attempt, by result (ok, none = nothing owed, retry, left, gave_up)',
  ['result'],
);
const boardsCreated = metrics.counter(
  'hrp_skating_boards_created_total',
  'Board entity sets created by result (ok, or the failed stage: ped, vehicle, board, driver; left = player gone)',
  ['result'],
);
const boardsRemoved = metrics.counter(
  'hrp_skating_boards_removed_total',
  'Board entity sets deleted by reason (pickup, logout, dropped, stop)',
  ['reason'],
);

export const skatingMetrics = {
  // business
  /** Boards whose entities exist in the world right now. */
  boardsOut: (count: number) => boardsOut.set(count),
  /** A board taken back after `seconds` out, `end` = what took it back. */
  session: (end: ReturnTrigger, seconds: number) => sessionSeconds.observe(seconds, { end }),
  // work
  use: (result: UseResult) => uses.inc({ result }),
  return: (trigger: ReturnTrigger, result: ReturnResult) => returns.inc({ trigger, result }),
  delivery: (result: DeliveryResult) => deliveries.inc({ result }),
  boardCreated: (result: BoardCreatedResult) => boardsCreated.inc({ result }),
  boardRemoved: (reason: ReturnTrigger) => boardsRemoved.inc({ reason }),
};
