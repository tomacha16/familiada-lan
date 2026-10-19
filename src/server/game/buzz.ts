import type { BuzzEntry, GameState, TeamId } from '../../shared/types.js';

/**
 * Rejestruje buzz gracza. Timestamp pochodzi z serwera — klient nie może
 * wpłynąć na kolejność zgłoszeń.
 */
export function registerBuzz(
  state: GameState,
  playerId: string,
  team: TeamId,
  now: number = Date.now()
): { entry: BuzzEntry; position: number } {
  const entry: BuzzEntry = { playerId, team, serverTimestamp: now };
  state.buzzQueue.push(entry);
  state.buzzQueue.sort((a, b) => a.serverTimestamp - b.serverTimestamp);
  const position = state.buzzQueue.findIndex((e) => e.playerId === playerId) + 1;
  return { entry, position };
}

export function clearBuzzQueue(state: GameState): void {
  state.buzzQueue = [];
}

/** Pierwszy gracz w kolejce (zwycięzca face-off). */
export function firstBuzz(state: GameState): BuzzEntry | null {
  return state.buzzQueue[0] ?? null;
}

export function hasBuzzed(state: GameState, playerId: string): boolean {
  return state.buzzQueue.some((e) => e.playerId === playerId);
}
