import type {
  FinalAnswerEntry,
  FinalPlayerState,
  FinalRoundState,
  GameState,
  QuestionRecord,
  TeamId,
} from '../../shared/types.js';
import { buildQuestionState } from './state.js';

/** Limity czasu finału zgodne z regulaminem. */
export const FINAL_TIME_LIMITS = { first: 15, second: 20 } as const;

function emptyPlayer(name: string, playerId: string | null): FinalPlayerState {
  return { playerId, name, answers: [], totalPoints: 0, finished: false };
}

/** Tworzy stan finału z 5 wylosowanych pytań i dwoma graczami. */
export function createFinalRound(
  team: TeamId,
  records: QuestionRecord[],
  targetPoints: number,
  firstPlayer: { id: string | null; name: string },
  secondPlayer: { id: string | null; name: string }
): FinalRoundState {
  return {
    team,
    questions: records.map(buildQuestionState),
    activePlayerIndex: 0,
    players: [emptyPlayer(firstPlayer.name, firstPlayer.id), emptyPlayer(secondPlayer.name, secondPlayer.id)],
    currentIndex: 0,
    totalPoints: 0,
    targetPoints,
    timeLimitSeconds: FINAL_TIME_LIMITS.first,
    questionStartedAt: Date.now(),
  };
}

/** Aktualnie odpowiadający gracz finałowy. */
export function activeFinalPlayer(final: FinalRoundState): FinalPlayerState {
  return final.players[final.activePlayerIndex];
}

/**
 * Zapisuje odpowiedź aktywnego gracza na bieżące pytanie.
 * Zwraca `false`, jeśli gracz już zakończył lub pytanie jest poza zakresem.
 */
export function submitFinalAnswer(state: GameState, text: string): boolean {
  const final = state.finalRound;
  if (!final) return false;

  const player = activeFinalPlayer(final);
  if (player.finished) return false;
  if (final.currentIndex >= final.questions.length) return false;

  player.answers.push({
    questionIndex: final.currentIndex,
    text: text.trim(),
    points: 0,
    answerId: null,
  });

  final.currentIndex += 1;
  final.questionStartedAt = Date.now();
  return true;
}

/** Pomija bieżące pytanie (gracz nie zna odpowiedzi). */
export function skipFinalQuestion(state: GameState): boolean {
  const final = state.finalRound;
  if (!final) return false;
  const player = activeFinalPlayer(final);
  if (player.finished) return false;
  if (final.currentIndex >= final.questions.length) return false;

  player.answers.push({
    questionIndex: final.currentIndex,
    text: '',
    points: 0,
    answerId: null,
  });
  final.currentIndex += 1;
  final.questionStartedAt = Date.now();
  return true;
}

/** Kończy turę aktywnego gracza i przechodzi do drugiego (lub do odkrycia). */
export function finishFinalPlayer(state: GameState): void {
  const final = state.finalRound;
  if (!final) return;

  activeFinalPlayer(final).finished = true;

  if (final.activePlayerIndex === 0) {
    final.activePlayerIndex = 1;
    final.currentIndex = 0;
    final.timeLimitSeconds = FINAL_TIME_LIMITS.second;
    final.questionStartedAt = Date.now();
  }
}

export function isFinalComplete(state: GameState): boolean {
  const final = state.finalRound;
  if (!final) return false;
  return final.players.every((p) => p.finished);
}

/**
 * Czy odpowiedź drugiego gracza powtarza odpowiedź pierwszego
 * (regulamin: powtórzenie = brzęczek, gracz musi dać inną odpowiedź).
 */
export function isDuplicateOfFirstPlayer(
  final: FinalRoundState,
  questionIndex: number,
  answerId: number
): boolean {
  const first = final.players[0];
  return first.answers.some((a) => a.questionIndex === questionIndex && a.answerId === answerId);
}

/**
 * Odkrywa odpowiedzi finałowe na podstawie dopasowań.
 * `matches` to tablica [gracz][pytanie] -> answerId | null.
 */
export function revealFinal(
  state: GameState,
  matches: Array<Array<number | null>>
): void {
  const final = state.finalRound;
  if (!final) return;

  let total = 0;

  final.players.forEach((player, playerIndex) => {
    player.totalPoints = 0;
    for (const entry of player.answers) {
      const answerId = matches[playerIndex]?.[entry.questionIndex] ?? null;
      if (answerId === null) {
        entry.answerId = null;
        entry.points = 0;
        continue;
      }
      const question = final.questions[entry.questionIndex];
      const answer = question?.answers.find((a) => a.answerId === answerId);
      if (!answer) {
        entry.answerId = null;
        entry.points = 0;
        continue;
      }
      entry.answerId = answerId;
      entry.points = answer.points;
      player.totalPoints += answer.points;
      answer.revealed = true;
    }
    total += player.totalPoints;
  });

  final.questions.forEach((q) => {
    q.revealedCount = q.answers.filter((a) => a.revealed).length;
  });

  final.totalPoints = total;
  state.teams[final.team].score += total;
}

export function finalPassed(state: GameState): boolean {
  const final = state.finalRound;
  if (!final) return false;
  return final.totalPoints >= final.targetPoints;
}

/** Czy minął limit czasu na bieżące pytanie. */
export function isFinalTimeUp(final: FinalRoundState, now: number = Date.now()): boolean {
  if (final.questionStartedAt === null) return false;
  return now - final.questionStartedAt > final.timeLimitSeconds * 1000;
}

export type { FinalAnswerEntry };
