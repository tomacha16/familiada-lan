import { DEFAULT_GAME_CONFIG } from '../config.js';
import type {
  AnswerState,
  GameConfig,
  GameState,
  QuestionRecord,
  QuestionState,
  TeamId,
  TeamState,
} from '../../shared/types.js';

export function createTeam(name: string): TeamState {
  return { name, score: 0, players: [], roundPoints: 0 };
}

export function createInitialState(roomCode: string, config?: Partial<GameConfig>): GameState {
  const merged: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config };
  return {
    roomCode,
    phase: 'lobby',
    roundIndex: 0,
    activeTeam: null,
    teams: {
      A: createTeam(merged.teamAName),
      B: createTeam(merged.teamBName),
    },
    currentQuestion: null,
    strikes: 0,
    buzzQueue: [],
    answeringPlayerId: null,
    familyHeads: { A: null, B: null },
    faceOffFirstAnswer: null,
    pointMultiplier: 1,
    questionsInRound: 0,
    canPassQuestion: false,
    finalRound: null,
    lastActionId: null,
    version: 0,
    config: merged,
    winner: null,
  };
}

/** Buduje stan pytania z rekordu bazy (wszystkie odpowiedzi ukryte). */
export function buildQuestionState(record: QuestionRecord): QuestionState {
  const answers: AnswerState[] = record.answers
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((a, index) => ({
      answerId: index + 1,
      text: a.text,
      points: a.points,
      rank: a.rank,
      revealed: false,
    }));

  return {
    questionId: record.id,
    text: record.text,
    answers,
    revealedCount: 0,
    totalPoints: answers.reduce((sum, a) => sum + a.points, 0),
  };
}

export function otherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}

/**
 * Mnożnik punktów zgodny z regulaminem:
 * - runda 1: ×1
 * - runda 2: ×2
 * - runda 3: ×2, a po czwartym pytaniu ×3
 */
export function multiplierFor(roundIndex: number, questionsInRound: number): number {
  if (roundIndex === 0) return 1;
  if (roundIndex === 1) return 2;
  // runda 3 i kolejne
  return questionsInRound >= 4 ? 3 : 2;
}

/** Inkrementuje wersję stanu — klienty wykrywają nowszy stan. */
export function bumpVersion(state: GameState): GameState {
  state.version += 1;
  return state;
}
