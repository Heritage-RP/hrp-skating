/** Net events — the names of astudios-skating, kept so the port changes nothing on the wire. */
export const EVENT = {
  /** server → client: the board left the inventory, put it down. */
  start: 'astudios-skating:client:start',
  /** client → server: the board is back in hand (or gone), give the item back. */
  giveItem: 'astudios-skating:server:giveItem',
} as const;

/** Network ids of the board's entities, created by the server (#310), sent with `EVENT.start`. */
export interface BoardNetIds {
  vehicle: number;
  board: number;
  driver: number;
}

/** Whether a `EVENT.start` payload carries three valid network ids. */
export function isBoardNetIds(value: unknown): value is BoardNetIds {
  if (typeof value !== 'object' || value === null) return false;
  const ids = value as Record<string, unknown>;
  return [ids.vehicle, ids.board, ids.driver].every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0);
}
