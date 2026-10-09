/** Net events — the names of astudios-skating, kept so the port changes nothing on the wire. */
export const EVENT = {
  /** server → client: the board left the inventory, put it down. */
  start: 'astudios-skating:client:start',
  /** client → server: the board is back in hand (or gone), give the item back. */
  giveItem: 'astudios-skating:server:giveItem',
} as const;
