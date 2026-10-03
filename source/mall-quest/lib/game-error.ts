/** Shared independently to avoid initialization cycles between game handlers. */
export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
