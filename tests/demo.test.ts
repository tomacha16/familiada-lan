import { describe, expect, it, vi } from 'vitest';
import type { QuestionRecord } from '../src/shared/types.js';

const questionPool: QuestionRecord[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  text: `Pytanie ${i + 1}`,
  category: 'test',
  roundType: i < 6 ? 'normal' : 'final',
  difficulty: 1,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  answers: [
    { text: 'odpowiedz 1', points: 30, rank: 1, aliases: [] },
    { text: 'odpowiedz 2', points: 20, rank: 2, aliases: [] },
    { text: 'odpowiedz 3', points: 10, rank: 3, aliases: [] },
  ],
}));

vi.mock('../src/server/db/questions.repo.js', () => ({
  pickRandomQuestions: (roundType: 'normal' | 'final', count: number) =>
    questionPool.filter((q) => q.roundType === roundType).slice(0, count),
}));

const { GameEngine } = await import('../src/server/game/engine.js');
const { createDemoBots, demoStep } = await import('../src/server/game/demo.js');

describe('Tryb demo', () => {
  it('tworzy 6 botów (po 3 na drużynę)', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    const bots = createDemoBots(engine);
    expect(bots).toHaveLength(6);
    expect(bots.filter((b) => b.team === 'A')).toHaveLength(3);
    expect(bots.filter((b) => b.team === 'B')).toHaveLength(3);
  });

  it('boty mają zróżnicowaną wiedzę', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    const bots = createDemoBots(engine);
    const captains = bots.filter((b) => b.knowledge === 0.85);
    expect(captains).toHaveLength(2);
  });

  it('flaga isDemo trafia do konfiguracji stanu', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    expect(engine.getState().config.isDemo).toBe(true);
  });

  it('demoStep przechodzi lobby -> round_intro -> face_off', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    const bots = createDemoBots(engine);

    expect(engine.getState().phase).toBe('lobby');
    demoStep(engine, bots, 1);
    expect(engine.getState().phase).toBe('round_intro');
    demoStep(engine, bots, 2);
    expect(engine.getState().phase).toBe('face_off');
    demoStep(engine, bots, 3);
    expect(['playing', 'face_off_second']).toContain(engine.getState().phase);
  });

  it('boty rozgrywają pełną grę do końca', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    const bots = createDemoBots(engine);

    let steps = 0;
    while (engine.getState().phase !== 'game_over' && steps < 800) {
      demoStep(engine, bots, steps);
      steps += 1;
    }

    expect(engine.getState().phase).toBe('game_over');
    expect(steps).toBeLessThan(800);
    expect(engine.getState().finalRound).not.toBeNull();
  });

  it('boty nie odpowiadają perfekcyjnie (pojawiają się strike-i)', () => {
    // Pojedyncza gra może przypadkiem przejść bez strike'a — sprawdzamy kilka.
    let sawStrike = false;

    for (let game = 0; game < 5 && !sawStrike; game += 1) {
      const engine = new GameEngine(`DEMO${game}`, {}, { isDemo: true });
      const bots = createDemoBots(engine);

      let steps = 0;
      while (engine.getState().phase !== 'game_over' && steps < 800) {
        const before = engine.getState().strikes;
        demoStep(engine, bots, steps);
        if (engine.getState().strikes > before) sawStrike = true;
        steps += 1;
      }
    }

    expect(sawStrike).toBe(true);
  });

  it('finał ma dwóch graczy i 5 pytań', () => {
    const engine = new GameEngine('DEMO', {}, { isDemo: true });
    const bots = createDemoBots(engine);

    let steps = 0;
    while (engine.getState().phase !== 'game_over' && steps < 800) {
      demoStep(engine, bots, steps);
      steps += 1;
    }

    const final = engine.getState().finalRound;
    expect(final).not.toBeNull();
    expect(final?.questions).toHaveLength(5);
    expect(final?.players).toHaveLength(2);
    expect(final?.players[0].finished).toBe(true);
    expect(final?.players[1].finished).toBe(true);
  });
});
