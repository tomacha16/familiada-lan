import type { GameState, TeamId } from '../../shared/types.js';
import type { GameEngine } from './engine.js';

/**
 * Tryb demo — boty rozgrywają grę automatycznie według oficjalnego regulaminu.
 *
 * Boty symulują graczy, którzy znają część odpowiedzi. Każdy bot ma
 * `knowledge` (0..1) — szansę, że zna daną odpowiedź. Dzięki temu gra
 * wygląda realistycznie (błędy, strike'i, przejęcia), a nie jak
 * perfekcyjne rozwiązanie.
 */

export interface DemoBot {
  playerId: string;
  name: string;
  team: TeamId;
  /** Prawdopodobieństwo, że bot zna odpowiedź (0..1). */
  knowledge: number;
}

export interface DemoControllerOptions {
  /** Opóźnienie między akcjami botów (ms). */
  tickMs?: number;
  /** Maksymalna liczba kroków, aby uniknąć pętli nieskończonej. */
  maxSteps?: number;
}

const BOT_NAMES: Record<TeamId, string[]> = {
  A: ['Ala', 'Bartek', 'Celina'],
  B: ['Dawid', 'Ewa', 'Franek'],
};

/** Tworzy boty i dodaje je do silnika. */
export function createDemoBots(engine: GameEngine): DemoBot[] {
  const bots: DemoBot[] = [];
  for (const team of ['A', 'B'] as const) {
    BOT_NAMES[team].forEach((name, index) => {
      const player = engine.addPlayer(name, team);
      bots.push({
        playerId: player.id,
        name,
        team,
        // Pierwszy bot w drużynie (głowa rodziny) jest "mocniejszy"
        knowledge: index === 0 ? 0.85 : 0.6,
      });
    });
  }
  return bots;
}

function pickBot(bots: DemoBot[], team: TeamId): DemoBot | null {
  const teamBots = bots.filter((b) => b.team === team);
  if (teamBots.length === 0) return null;
  return teamBots[Math.floor(Math.random() * teamBots.length)] ?? null;
}

function unrevealedAnswers(state: GameState) {
  return state.currentQuestion?.answers.filter((a) => !a.revealed) ?? [];
}

/** Bot odpowiada: z prawdopodobieństwem `knowledge` trafia w odpowiedź. */
function botAnswer(
  state: GameState,
  bot: DemoBot
): { answerId: number | null; rank: number | null } {
  const remaining = unrevealedAnswers(state);
  if (remaining.length === 0) return { answerId: null, rank: null };
  if (Math.random() >= bot.knowledge) return { answerId: null, rank: null };

  const answer = remaining[Math.floor(Math.random() * remaining.length)]!;
  return { answerId: answer.answerId, rank: answer.rank };
}

/**
 * Wykonuje jeden krok demo w zależności od fazy gry.
 * Zwraca `true`, jeśli wykonano akcję.
 */
export function demoStep(engine: GameEngine, bots: DemoBot[], step: number): boolean {
  const state = engine.getState();
  const actionId = `demo-${step}-${Date.now()}`;

  switch (state.phase) {
    case 'lobby': {
      engine.startGame(actionId);
      return true;
    }

    case 'round_intro': {
      engine.showQuestion(actionId);
      return true;
    }

    case 'face_off': {
      // Głowa rodziny A odpowiada pierwsza (w demo nie ma realnego buzzowania)
      const headA = bots.find((b) => b.playerId === state.familyHeads.A);
      const bot = headA ?? pickBot(bots, 'A');
      if (!bot) return false;
      const { answerId } = botAnswer(state, bot);
      engine.faceOffAnswer(actionId, 'A', answerId);
      return true;
    }

    case 'face_off_second': {
      const headB = bots.find((b) => b.playerId === state.familyHeads.B);
      const bot = headB ?? pickBot(bots, 'B');
      if (!bot) return false;
      const { answerId } = botAnswer(state, bot);
      engine.faceOffSecondAnswer(actionId, 'B', answerId);
      return true;
    }

    case 'playing':
    case 'steal': {
      const team = state.activeTeam ?? 'A';
      const bot = pickBot(bots, team);
      if (!bot) return false;

      const remaining = unrevealedAnswers(state);
      if (remaining.length === 0) return false;

      const { answerId } = botAnswer(state, bot);
      if (answerId !== null) {
        engine.confirmAnswer(actionId, answerId);
      } else {
        engine.rejectAnswer(actionId);
      }
      return true;
    }

    case 'round_summary': {
      engine.nextRound(actionId);
      return true;
    }

    case 'final_intro': {
      // Finał gra drużyna z wyższym wynikiem
      const team: TeamId = state.teams.A.score >= state.teams.B.score ? 'A' : 'B';
      const teamBots = bots.filter((b) => b.team === team);
      const first = teamBots[0];
      const second = teamBots[1] ?? teamBots[0];
      if (!first || !second) return false;
      engine.startFinal(
        actionId,
        team,
        { id: first.playerId, name: first.name },
        { id: second.playerId, name: second.name }
      );
      return true;
    }

    case 'final_answers': {
      const final = state.finalRound;
      if (!final) return false;

      const player = final.players[final.activePlayerIndex];
      if (player.finished) return false;

      const question = final.questions[final.currentIndex];
      if (!question) {
        // Wszystkie pytania wypełnione — kończymy turę gracza
        if (final.activePlayerIndex === 0) {
          engine.finishFinalPlayer(actionId);
          return true;
        }
        // Drugi gracz skończył — oznaczamy go jako finished i odkrywamy finał
        engine.finishFinalPlayer(`${actionId}-finish`);
        const matches = final.players.map((p) =>
          p.answers.map((entry) => {
            const q = final.questions[entry.questionIndex];
            if (!q) return null;
            const bot = pickBot(bots, final.team);
            const knows = bot ? Math.random() < bot.knowledge : false;
            if (!knows) return null;
            return q.answers[Math.floor(Math.random() * q.answers.length)]!.answerId;
          })
        );
        engine.revealFinal(`${actionId}-reveal`, matches);
        return true;
      }

      const bot = pickBot(bots, final.team);
      const knows = bot ? Math.random() < bot.knowledge : false;
      if (knows) {
        const answer = question.answers[Math.floor(Math.random() * question.answers.length)]!;
        engine.submitFinalAnswer(actionId, answer.text);
      } else {
        engine.skipFinalQuestion(actionId);
      }
      return true;
    }

    case 'final_reveal': {
      engine.endGame(actionId);
      return true;
    }

    case 'game_over': {
      return false;
    }

    default:
      return false;
  }
}

/**
 * Uruchamia automatyczną rozgrywkę demo.
 * Zwraca funkcję zatrzymującą.
 */
export function startDemo(
  engine: GameEngine,
  bots: DemoBot[],
  onTick?: (state: GameState) => void,
  options: DemoControllerOptions = {}
): () => void {
  const tickMs = options.tickMs ?? 1800;
  const maxSteps = options.maxSteps ?? 800;
  let step = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const run = (): void => {
    if (stopped) return;
    if (step >= maxSteps) {
      stopped = true;
      return;
    }
    step += 1;

    try {
      demoStep(engine, bots, step);
    } catch (error) {
      console.error('[demo] Błąd kroku:', error);
    }

    onTick?.(engine.getState());

    if (engine.getState().phase === 'game_over') {
      stopped = true;
      return;
    }

    timer = setTimeout(run, tickMs);
  };

  timer = setTimeout(run, tickMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
