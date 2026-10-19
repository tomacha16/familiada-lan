/**
 * Typy współdzielone między serwerem a klientami (TV, telefon, panel hosta).
 * Ten plik jest źródłem prawdy dla kontraktów Socket.IO i REST.
 */

export type TeamId = 'A' | 'B';

export type Phase =
  | 'lobby'
  | 'round_intro'
  | 'face_off'
  | 'face_off_second' // druga głowa rodziny odpowiada po błędzie pierwszej
  | 'playing'
  | 'steal'
  | 'round_summary'
  | 'final_intro'
  | 'final_answers'
  | 'final_reveal'
  | 'game_over';

export type Role = 'tv' | 'player' | 'host';

export interface PlayerState {
  id: string;
  name: string;
  team: TeamId;
  connected: boolean;
  isCaptain: boolean;
}

export interface TeamState {
  name: string;
  score: number;
  players: PlayerState[];
  roundPoints: number;
}

export interface AnswerState {
  answerId: number;
  text: string;
  points: number;
  rank: number;
  revealed: boolean;
}

export interface QuestionState {
  questionId: number;
  text: string;
  answers: AnswerState[];
  revealedCount: number;
  totalPoints: number;
}

export interface BuzzEntry {
  playerId: string;
  team: TeamId;
  serverTimestamp: number;
}

/** Odpowiedź jednego gracza finałowego na jedno pytanie. */
export interface FinalAnswerEntry {
  questionIndex: number;
  text: string;
  /** Punkty naliczone po dopasowaniu (0 jeśli brak trafienia). */
  points: number;
  /** answerId trafionej odpowiedzi (null = brak trafienia). */
  answerId: number | null;
}

/** Stan jednego z dwóch graczy finałowych. */
export interface FinalPlayerState {
  playerId: string | null;
  name: string;
  answers: FinalAnswerEntry[];
  totalPoints: number;
  /** Czy gracz zakończył odpowiadanie. */
  finished: boolean;
}

export interface FinalRoundState {
  team: TeamId;
  questions: QuestionState[];
  /** 0 = pierwszy gracz, 1 = drugi gracz. */
  activePlayerIndex: 0 | 1;
  players: [FinalPlayerState, FinalPlayerState];
  /** Indeks aktualnie czytanego pytania dla aktywnego gracza. */
  currentIndex: number;
  totalPoints: number;
  targetPoints: number;
  /** Limit czasu na odpowiedź (sekundy): 15 dla pierwszego, 20 dla drugiego. */
  timeLimitSeconds: number;
  /** Znacznik czasu startu pytania (ms) — do timera. */
  questionStartedAt: number | null;
}

export interface GameConfig {
  teamAName: string;
  teamBName: string;
  /** Liczba rund (oficjalnie 3). */
  roundsCount: number;
  /** Próg zwycięstwa w grze głównej (oficjalnie 300). */
  gameTargetPoints: number;
  /** Próg finału (oficjalnie 200). */
  finalTargetPoints: number;
  maxStrikes: number;
  /** Limit czasu na odpowiedź w rundzie głównej (sekundy, oficjalnie 3). */
  answerTimeLimitSeconds: number;
  /** Tryb demo: boty grają automatycznie, host może obserwować. */
  isDemo?: boolean;
}

export interface GameState {
  roomCode: string;
  phase: Phase;
  roundIndex: number;
  activeTeam: TeamId | null;
  teams: Record<TeamId, TeamState>;
  currentQuestion: QuestionState | null;
  strikes: number;
  buzzQueue: BuzzEntry[];
  answeringPlayerId: string | null;
  /** Głowa rodziny każdej drużyny (id gracza) — odpowiada w face-off. */
  familyHeads: Record<TeamId, string | null>;
  /** Wynik pierwszej głowy w face-off (do porównania pozycji). */
  faceOffFirstAnswer: { team: TeamId; answerId: number | null; rank: number | null } | null;
  /** Mnożnik punktów bieżącego pytania (×1, ×2, ×3). */
  pointMultiplier: number;
  /** Liczba pytań zadanych w bieżącej rundzie (do progu ×3). */
  questionsInRound: number;
  /** Czy drużyna może oddać pytanie przeciwnikom (po trafieniu w face-off). */
  canPassQuestion: boolean;
  finalRound: FinalRoundState | null;
  lastActionId: string | null;
  version: number;
  config: GameConfig;
  winner: TeamId | null;
}

/* ------------------------------------------------------------------ */
/* Kontrakty Socket.IO                                                 */
/* ------------------------------------------------------------------ */

export interface AuthPayload {
  role: Role;
  roomCode: string;
  playerId?: string;
  hostPin?: string;
}

export interface MatchResult {
  answerId: number;
  text: string;
  points: number;
  rank: number;
  score: number;
  exact: boolean;
}

export interface StatePatch {
  version: number;
  patch: Partial<GameState>;
}

export interface GameError {
  code: string;
  message: string;
}

/** Eventy klient -> serwer */
export interface ClientToServerEvents {
  'player:join': (payload: { name: string; team: TeamId }, ack?: (res: JoinResult) => void) => void;
  'player:buzz': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:startGame': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:showQuestion': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:setFamilyHead': (
    payload: { actionId: string; team: TeamId; playerId: string },
    ack?: (res: AckResult) => void
  ) => void;
  'host:faceOffAnswer': (
    payload: { actionId: string; team: TeamId; answerId: number | null },
    ack?: (res: AckResult) => void
  ) => void;
  'host:faceOffSecondAnswer': (
    payload: { actionId: string; team: TeamId; answerId: number | null },
    ack?: (res: AckResult) => void
  ) => void;
  'host:selectAnswerer': (
    payload: { actionId: string; playerId: string },
    ack?: (res: AckResult) => void
  ) => void;
  'host:submitAnswer': (
    payload: { actionId: string; text: string },
    ack?: (res: SubmitAnswerResult) => void
  ) => void;
  'host:confirmAnswer': (
    payload: { actionId: string; answerId: number },
    ack?: (res: AckResult) => void
  ) => void;
  'host:rejectAnswer': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:passQuestion': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:nextRound': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:startFinal': (
    payload: {
      actionId: string;
      team: TeamId;
      firstPlayer: { id: string | null; name: string };
      secondPlayer: { id: string | null; name: string };
    },
    ack?: (res: AckResult) => void
  ) => void;
  'host:submitFinalAnswer': (
    payload: { actionId: string; text: string },
    ack?: (res: AckResult) => void
  ) => void;
  'host:skipFinalQuestion': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:finishFinalPlayer': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:revealFinal': (
    payload: { actionId: string; matches: Array<Array<number | null>> },
    ack?: (res: AckResult) => void
  ) => void;
  'host:endGame': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:resetGame': (payload: { actionId: string }, ack?: (res: AckResult) => void) => void;
  'host:updateConfig': (
    payload: { actionId: string; config: Partial<GameConfig> },
    ack?: (res: AckResult) => void
  ) => void;
}

/** Eventy serwer -> klient */
export interface ServerToClientEvents {
  'state:sync': (state: GameState) => void;
  'state:patch': (patch: StatePatch) => void;
  'buzz:registered': (payload: { playerId: string; position: number }) => void;
  'buzz:winner': (payload: { playerId: string; team: TeamId }) => void;
  'answer:suggestions': (payload: { matches: MatchResult[] }) => void;
  'answer:revealed': (payload: { answerId: number; points: number }) => void;
  'answer:strike': (payload: { strikes: number }) => void;
  'room:players': (players: PlayerState[]) => void;
  'game:error': (error: GameError) => void;
}

export interface AckResult {
  ok: boolean;
  error?: GameError;
}

export interface JoinResult extends AckResult {
  playerId?: string;
  state?: GameState;
}

export interface SubmitAnswerResult extends AckResult {
  matches?: MatchResult[];
}

/* ------------------------------------------------------------------ */
/* REST / baza pytań                                                   */
/* ------------------------------------------------------------------ */

export interface AnswerInput {
  text: string;
  points: number;
  rank: number;
  aliases?: string[];
}

export interface QuestionInput {
  text: string;
  category?: string | null;
  roundType?: 'normal' | 'final';
  difficulty?: number;
  isActive?: boolean;
  answers: AnswerInput[];
}

export interface QuestionRecord {
  id: number;
  text: string;
  category: string | null;
  roundType: 'normal' | 'final';
  difficulty: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  answers: AnswerInput[];
}

export interface GameSummary {
  id: number;
  roomCode: string;
  startedAt: string;
  finishedAt: string | null;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
}
