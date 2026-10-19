import type {
  GameConfig,
  GameState,
  PlayerState,
  QuestionRecord,
  TeamId,
} from '../../shared/types.js';
import { pickRandomQuestions } from '../db/questions.repo.js';
import { clearBuzzQueue, firstBuzz, hasBuzzed, registerBuzz } from './buzz.js';
import {
  activeFinalPlayer,
  createFinalRound,
  finishFinalPlayer,
  isFinalComplete,
  revealFinal,
  skipFinalQuestion,
  submitFinalAnswer,
} from './final.js';
import {
  addStrike,
  allRevealed,
  determineWinner,
  hasMaxStrikes,
  reachedGameTarget,
  revealAnswer,
  settleRound,
  stealPot,
} from './scoring.js';
import {
  buildQuestionState,
  bumpVersion,
  createInitialState,
  multiplierFor,
  otherTeam,
} from './state.js';

export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export interface EngineHooks {
  /** Wywoływane po każdej udanej zmianie stanu (snapshot, broadcast). */
  onChange?: (state: GameState, eventType: string) => void;
}

/**
 * Silnik gry — jedyne miejsce, które mutuje stan.
 * Reguły zgodne z oficjalnym regulaminem Familiady:
 * - 3 rundy, gra do 300 pkt
 * - mnożniki: runda 1 ×1, runda 2 ×2, runda 3 ×2 (po 4. pytaniu ×3)
 * - face-off głów rodzin z porównaniem pozycji odpowiedzi
 * - możliwość oddania pytania przeciwnikom
 * - 3 sekundy na odpowiedź
 * - finał: 2 graczy, 5 pytań, 200 pkt, 15s/20s
 */
export class GameEngine {
  private state: GameState;
  private readonly hooks: EngineHooks;
  private readonly usedActionIds = new Set<string>();

  constructor(roomCode: string, hooks: EngineHooks = {}, config?: Partial<GameConfig>) {
    this.state = createInitialState(roomCode, config);
    this.hooks = hooks;
  }

  getState(): GameState {
    return this.state;
  }

  /* ----------------------------- gracze ----------------------------- */

  addPlayer(name: string, team: TeamId): PlayerState {
    const trimmed = name.trim();
    if (!trimmed) throw new GameError('INVALID_NAME', 'Imię nie może być puste');
    if (trimmed.length > 24) throw new GameError('INVALID_NAME', 'Imię jest za długie');

    const duplicate = Object.values(this.state.teams)
      .flatMap((t) => t.players)
      .some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) throw new GameError('DUPLICATE_NAME', 'Gracz o tym imieniu już istnieje');

    const player: PlayerState = {
      id: crypto.randomUUID(),
      name: trimmed,
      team,
      connected: true,
      isCaptain: this.state.teams[team].players.length === 0,
    };
    this.state.teams[team].players.push(player);

    // Pierwszy gracz drużyny zostaje głową rodziny
    if (this.state.familyHeads[team] === null) {
      this.state.familyHeads[team] = player.id;
    }

    this.emit('player:join');
    return player;
  }

  setPlayerConnected(playerId: string, connected: boolean): void {
    for (const team of ['A', 'B'] as const) {
      const player = this.state.teams[team].players.find((p) => p.id === playerId);
      if (player) {
        player.connected = connected;
        this.emit('player:connection');
        return;
      }
    }
  }

  findPlayer(playerId: string): PlayerState | null {
    for (const team of ['A', 'B'] as const) {
      const player = this.state.teams[team].players.find((p) => p.id === playerId);
      if (player) return player;
    }
    return null;
  }

  /** Ustawia głowę rodziny danej drużyny. */
  setFamilyHead(actionId: string, team: TeamId, playerId: string): void {
    this.guardAction(actionId, ['lobby', 'round_intro']);
    const player = this.findPlayer(playerId);
    if (!player || player.team !== team) {
      throw new GameError('INVALID_PLAYER', 'Gracz nie należy do tej drużyny');
    }
    this.state.familyHeads[team] = playerId;
    this.emit('host:setFamilyHead');
  }

  /* ----------------------------- buzz ------------------------------- */

  buzz(playerId: string): { position: number } {
    if (this.state.phase !== 'face_off') {
      throw new GameError('WRONG_PHASE', 'Buzzowanie jest możliwe tylko w pojedynku');
    }
    const player = this.findPlayer(playerId);
    if (!player) throw new GameError('UNKNOWN_PLAYER', 'Nieznany gracz');
    if (hasBuzzed(this.state, playerId)) {
      throw new GameError('ALREADY_BUZZED', 'Już zgłosiłeś się do odpowiedzi');
    }

    const { position } = registerBuzz(this.state, playerId, player.team);
    this.emit('player:buzz');
    return { position };
  }

  /* --------------------------- sterowanie --------------------------- */

  startGame(actionId: string): void {
    this.guardAction(actionId, 'lobby');
    this.state.phase = 'round_intro';
    this.state.roundIndex = 0;
    this.state.questionsInRound = 0;
    this.state.pointMultiplier = multiplierFor(0, 0);
    this.state.winner = null;
    this.emit('host:startGame');
  }

  showQuestion(actionId: string): void {
    this.guardAction(actionId, 'round_intro');
    const record = this.pickQuestion('normal');
    this.state.currentQuestion = buildQuestionState(record);
    this.state.strikes = 0;
    this.state.activeTeam = null;
    this.state.answeringPlayerId = null;
    this.state.faceOffFirstAnswer = null;
    this.state.canPassQuestion = false;
    this.state.pointMultiplier = multiplierFor(
      this.state.roundIndex,
      this.state.questionsInRound
    );
    clearBuzzQueue(this.state);
    this.state.phase = 'face_off';
    this.emit('host:showQuestion');
  }

  /**
   * Face-off: pierwsza głowa rodziny odpowiada.
   * `answerId = null` oznacza błędną odpowiedź (nie ma jej na tablicy).
   */
  faceOffAnswer(actionId: string, team: TeamId, answerId: number | null): void {
    this.guardAction(actionId, 'face_off');
    const question = this.state.currentQuestion;
    if (!question) throw new GameError('NO_QUESTION', 'Brak aktywnego pytania');

    const answer = answerId === null ? null : question.answers.find((a) => a.answerId === answerId);

    if (!answer) {
      // Błędna odpowiedź — szansę dostaje druga głowa
      this.state.faceOffFirstAnswer = { team, answerId: null, rank: null };
      this.state.phase = 'face_off_second';
      this.emit('host:faceOffAnswer');
      return;
    }

    // Trafiona odpowiedź — najpierw ustawiamy drużynę, potem odkrywamy,
    // aby punkty trafiły do właściwej puli.
    this.state.activeTeam = team;
    revealAnswer(this.state, answer.answerId);
    this.state.faceOffFirstAnswer = { team, answerId: answer.answerId, rank: answer.rank };
    this.state.answeringPlayerId = this.state.familyHeads[team];
    this.state.canPassQuestion = true;
    this.state.phase = 'playing';
    this.emit('host:faceOffAnswer');
  }

  /**
   * Face-off: odpowiedź drugiej głowy rodziny.
   * Jeśli trafi wyżej na tablicy — jej drużyna przejmuje pytanie.
   */
  faceOffSecondAnswer(actionId: string, team: TeamId, answerId: number | null): void {
    this.guardAction(actionId, 'face_off_second');
    const question = this.state.currentQuestion;
    if (!question) throw new GameError('NO_QUESTION', 'Brak aktywnego pytania');

    const first = this.state.faceOffFirstAnswer;
    const answer = answerId === null ? null : question.answers.find((a) => a.answerId === answerId);

    if (!answer) {
      // Obie głowy się pomyliły — pytanie przechodzi do pierwszej drużyny
      this.state.activeTeam = first?.team ?? team;
      this.state.answeringPlayerId = this.state.familyHeads[this.state.activeTeam];
      this.state.phase = 'playing';
      this.emit('host:faceOffSecondAnswer');
      return;
    }

    revealAnswer(this.state, answer.answerId);

    // Druga odpowiedź wygrywa, jeśli jest wyżej (mniejszy rank) niż pierwsza
    const firstRank = first?.rank ?? Number.POSITIVE_INFINITY;
    const secondWins = answer.rank < firstRank;

    this.state.activeTeam = secondWins ? team : (first?.team ?? team);
    this.state.answeringPlayerId = this.state.familyHeads[this.state.activeTeam];
    this.state.canPassQuestion = true;
    this.state.phase = 'playing';
    this.emit('host:faceOffSecondAnswer');
  }

  /** Wybór odpowiadającego (host może wskazać dowolnego gracza drużyny). */
  selectAnswerer(actionId: string, playerId: string): void {
    this.guardAction(actionId, ['face_off', 'playing', 'steal']);
    const player = this.findPlayer(playerId);
    if (!player) throw new GameError('UNKNOWN_PLAYER', 'Nieznany gracz');

    this.state.answeringPlayerId = playerId;
    this.state.activeTeam = player.team;
    if (this.state.phase === 'face_off') this.state.phase = 'playing';
    this.emit('host:selectAnswerer');
  }

  /** Zatwierdza trafienie: odkrywa odpowiedź i przechodzi dalej. */
  confirmAnswer(actionId: string, answerId: number): void {
    this.guardAction(actionId, ['playing', 'steal']);
    const question = this.state.currentQuestion;
    if (!question) throw new GameError('NO_QUESTION', 'Brak aktywnego pytania');

    const revealed = revealAnswer(this.state, answerId);
    if (!revealed) throw new GameError('INVALID_ANSWER', 'Odpowiedź nie istnieje lub jest już odkryta');

    if (allRevealed(question)) {
      settleRound(this.state);
      this.state.phase = 'round_summary';
    } else if (this.state.phase === 'steal') {
      // Udany steal kończy rundę
      settleRound(this.state);
      this.state.phase = 'round_summary';
    }
    this.emit('host:confirmAnswer');
  }

  /** Odrzuca odpowiedź: strike, ewentualnie przejście do steal. */
  rejectAnswer(actionId: string): void {
    this.guardAction(actionId, ['playing', 'steal']);
    addStrike(this.state);

    if (this.state.phase === 'steal') {
      // Nieudany steal — pula wraca do pierwotnej drużyny
      stealPot(this.state);
      settleRound(this.state);
      this.state.phase = 'round_summary';
    } else if (hasMaxStrikes(this.state)) {
      // Przejście do steal: pula przechodzi na drugą drużynę
      stealPot(this.state);
      this.state.phase = 'steal';
      this.state.answeringPlayerId = this.state.familyHeads[this.state.activeTeam ?? 'A'];
    }
    this.emit('host:rejectAnswer');
  }

  /**
   * Oddanie pytania drużynie przeciwnej (regulamin: drużyna może
   * zrezygnować z odpowiedzi i przekazać wygrane punkty przeciwnikom).
   */
  passQuestion(actionId: string): void {
    this.guardAction(actionId, 'playing');
    if (!this.state.canPassQuestion) {
      throw new GameError('CANNOT_PASS', 'Nie można teraz oddać pytania');
    }
    stealPot(this.state);
    this.state.phase = 'steal';
    this.state.strikes = 0;
    this.state.canPassQuestion = false;
    this.state.answeringPlayerId = this.state.familyHeads[this.state.activeTeam ?? 'A'];
    this.emit('host:passQuestion');
  }

  nextRound(actionId: string): void {
    this.guardAction(actionId, 'round_summary');

    // Zwycięstwo przy osiągnięciu progu punktowego (300 pkt)
    const targetWinner = reachedGameTarget(this.state);
    if (targetWinner) {
      this.state.winner = targetWinner;
      this.state.phase = 'final_intro';
      this.state.currentQuestion = null;
      this.emit('host:nextRound');
      return;
    }

    const nextIndex = this.state.roundIndex + 1;
    if (nextIndex >= this.state.config.roundsCount) {
      // Koniec rund — wygrywa drużyna z wyższym wynikiem
      this.state.winner = determineWinner(this.state);
      this.state.phase = 'final_intro';
    } else {
      this.state.roundIndex = nextIndex;
      this.state.questionsInRound = 0;
      this.state.pointMultiplier = multiplierFor(nextIndex, 0);
      this.state.phase = 'round_intro';
    }
    this.state.currentQuestion = null;
    this.state.strikes = 0;
    this.state.activeTeam = null;
    this.state.answeringPlayerId = null;
    this.state.faceOffFirstAnswer = null;
    this.state.canPassQuestion = false;
    clearBuzzQueue(this.state);
    this.emit('host:nextRound');
  }

  /* ----------------------------- finał ------------------------------ */

  startFinal(
    actionId: string,
    team: TeamId,
    firstPlayer: { id: string | null; name: string },
    secondPlayer: { id: string | null; name: string }
  ): void {
    this.guardAction(actionId, 'final_intro');
    const records = pickRandomQuestions('final', 5);
    if (records.length < 5) {
      throw new GameError('NOT_ENOUGH_QUESTIONS', 'Wymagane jest co najmniej 5 pytań finałowych');
    }
    this.state.finalRound = createFinalRound(
      team,
      records,
      this.state.config.finalTargetPoints,
      firstPlayer,
      secondPlayer
    );
    this.state.phase = 'final_answers';
    this.emit('host:startFinal');
  }

  submitFinalAnswer(actionId: string, text: string): void {
    this.guardAction(actionId, 'final_answers');
    if (!text.trim()) throw new GameError('EMPTY_ANSWER', 'Odpowiedź nie może być pusta');
    if (!submitFinalAnswer(this.state, text)) {
      throw new GameError('FINAL_COMPLETE', 'Wszystkie pytania finałowe zostały już wypełnione');
    }
    this.emit('host:submitFinalAnswer');
  }

  skipFinalQuestion(actionId: string): void {
    this.guardAction(actionId, 'final_answers');
    if (!skipFinalQuestion(this.state)) {
      throw new GameError('FINAL_COMPLETE', 'Brak pytania do pominięcia');
    }
    this.emit('host:skipFinalQuestion');
  }

  /**
   * Kończy turę aktywnego gracza.
   * Pierwsze wywołanie przełącza na drugiego gracza,
   * drugie oznacza drugiego jako finished (gotowe do odkrycia).
   */
  finishFinalPlayer(actionId: string): void {
    this.guardAction(actionId, 'final_answers');
    const final = this.state.finalRound;
    if (!final) throw new GameError('NO_FINAL', 'Brak aktywnego finału');
    if (final.players[final.activePlayerIndex].finished) {
      throw new GameError('ALREADY_FINISHED', 'Ten gracz już zakończył odpowiedzi');
    }
    finishFinalPlayer(this.state);
    this.emit('host:finishFinalPlayer');
  }

  revealFinal(actionId: string, matches: Array<Array<number | null>>): void {
    this.guardAction(actionId, 'final_answers');
    if (!isFinalComplete(this.state)) {
      throw new GameError('FINAL_INCOMPLETE', 'Najpierw ukończ odpowiedzi obu graczy');
    }
    revealFinal(this.state, matches);
    this.state.phase = 'final_reveal';
    this.emit('host:revealFinal');
  }

  endGame(actionId: string): void {
    this.guardAction(actionId, ['final_reveal', 'round_summary']);
    if (!this.state.winner) {
      this.state.winner = determineWinner(this.state);
    }
    this.state.phase = 'game_over';
    this.emit('host:endGame');
  }

  resetGame(actionId: string): void {
    this.guardAction(actionId, [
      'game_over',
      'lobby',
      'round_intro',
      'face_off',
      'face_off_second',
      'playing',
      'steal',
      'round_summary',
      'final_intro',
      'final_answers',
      'final_reveal',
    ]);
    const players = {
      A: this.state.teams.A.players,
      B: this.state.teams.B.players,
    };
    const config = this.state.config;
    this.state = createInitialState(this.state.roomCode, config);
    this.state.teams.A.players = players.A;
    this.state.teams.B.players = players.B;
    this.state.familyHeads = {
      A: players.A[0]?.id ?? null,
      B: players.B[0]?.id ?? null,
    };
    this.usedActionIds.clear();
    this.emit('host:resetGame');
  }

  updateConfig(actionId: string, config: Partial<GameConfig>): void {
    this.guardAction(actionId, 'lobby');
    this.state.config = { ...this.state.config, ...config };
    this.state.teams.A.name = this.state.config.teamAName;
    this.state.teams.B.name = this.state.config.teamBName;
    this.emit('host:updateConfig');
  }

  /* ---------------------------- pomocnicze -------------------------- */

  private pickQuestion(roundType: 'normal' | 'final'): QuestionRecord {
    const [record] = pickRandomQuestions(roundType, 1);
    if (!record) {
      throw new GameError('NOT_ENOUGH_QUESTIONS', `Brak aktywnych pytań typu ${roundType}`);
    }
    return record;
  }

  /** Waliduje fazę i idempotencję akcji. */
  private guardAction(actionId: string, allowed: GameState['phase'] | GameState['phase'][]): void {
    if (!actionId) throw new GameError('MISSING_ACTION_ID', 'Brak actionId');
    if (this.usedActionIds.has(actionId)) {
      throw new GameError('DUPLICATE_ACTION', 'Akcja została już wykonana');
    }
    const phases = Array.isArray(allowed) ? allowed : [allowed];
    if (!phases.includes(this.state.phase)) {
      throw new GameError(
        'WRONG_PHASE',
        `Akcja niedozwolona w fazie ${this.state.phase} (dozwolone: ${phases.join(', ')})`
      );
    }
    this.usedActionIds.add(actionId);
    this.state.lastActionId = actionId;
  }

  private emit(eventType: string): void {
    bumpVersion(this.state);
    this.hooks.onChange?.(this.state, eventType);
  }
}

export { firstBuzz, activeFinalPlayer, otherTeam };
