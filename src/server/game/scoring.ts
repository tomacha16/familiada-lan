import type { GameState, QuestionState, TeamId } from '../../shared/types.js';
import { otherTeam } from './state.js';

/** Suma punktów odkrytych odpowiedzi w bieżącym pytaniu (bez mnożnika). */
export function revealedPoints(question: QuestionState): number {
  return question.answers.filter((a) => a.revealed).reduce((sum, a) => sum + a.points, 0);
}

export function allRevealed(question: QuestionState): boolean {
  return question.answers.every((a) => a.revealed);
}

/**
 * Odkrywa odpowiedź i dolicza punkty (z mnożnikiem) do puli rundy
 * aktywnej drużyny. Zwraca true, jeśli odpowiedź została odkryta.
 */
export function revealAnswer(state: GameState, answerId: number): boolean {
  const question = state.currentQuestion;
  if (!question) return false;

  const answer = question.answers.find((a) => a.answerId === answerId);
  if (!answer || answer.revealed) return false;

  answer.revealed = true;
  question.revealedCount = question.answers.filter((a) => a.revealed).length;

  const team = state.activeTeam;
  if (team) {
    state.teams[team].roundPoints += answer.points * state.pointMultiplier;
  }
  return true;
}

/** Dodaje strike; zwraca aktualną liczbę strike'ów. */
export function addStrike(state: GameState): number {
  state.strikes += 1;
  return state.strikes;
}

export function hasMaxStrikes(state: GameState): boolean {
  return state.strikes >= state.config.maxStrikes;
}

/** Rozlicza rundę: pula trafia do drużyny, która ją zdobyła. */
export function settleRound(state: GameState): void {
  const team = state.activeTeam;
  if (!team) return;
  state.teams[team].score += state.teams[team].roundPoints;
  state.teams.A.roundPoints = 0;
  state.teams.B.roundPoints = 0;
}

/** Przejęcie puli przez drugą drużynę (udany steal). */
export function stealPot(state: GameState): void {
  const current = state.activeTeam;
  if (!current) return;
  const stealer = otherTeam(current);
  state.teams[stealer].roundPoints = state.teams[current].roundPoints;
  state.teams[current].roundPoints = 0;
  state.activeTeam = stealer;
}

/** Czy któraś drużyna osiągnęła próg zwycięstwa (300 pkt). */
export function reachedGameTarget(state: GameState): TeamId | null {
  if (state.teams.A.score >= state.config.gameTargetPoints) return 'A';
  if (state.teams.B.score >= state.config.gameTargetPoints) return 'B';
  return null;
}

/** Zwycięzca gry na podstawie wyniku końcowego. */
export function determineWinner(state: GameState): TeamId | null {
  const a = state.teams.A.score;
  const b = state.teams.B.score;
  if (a === b) return null;
  return a > b ? 'A' : 'B';
}
