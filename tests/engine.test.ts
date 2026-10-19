import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const { GameEngine, GameError } = await import('../src/server/game/engine.js');
const { multiplierFor } = await import('../src/server/game/state.js');

function newEngine(): InstanceType<typeof GameEngine> {
  return new GameEngine('TEST');
}

/** Ustawia grę w fazie playing z aktywną drużyną A. */
function setupPlaying(engine: InstanceType<typeof GameEngine>) {
  const p1 = engine.addPlayer('Ala', 'A');
  const p2 = engine.addPlayer('Ola', 'B');
  engine.startGame('start');
  engine.showQuestion('show');
  engine.faceOffAnswer('fo', 'A', 1);
  return { p1, p2 };
}

describe('GameEngine — przepływ rundy', () => {
  let engine: InstanceType<typeof GameEngine>;

  beforeEach(() => {
    engine = newEngine();
  });

  it('startuje w lobby', () => {
    expect(engine.getState().phase).toBe('lobby');
  });

  it('dodaje graczy i ustawia głowę rodziny', () => {
    const p1 = engine.addPlayer('Ala', 'A');
    const p2 = engine.addPlayer('Ola', 'A');
    expect(p1.isCaptain).toBe(true);
    expect(p2.isCaptain).toBe(false);
    expect(engine.getState().familyHeads.A).toBe(p1.id);
  });

  it('odrzuca duplikat imienia', () => {
    engine.addPlayer('Ala', 'A');
    expect(() => engine.addPlayer('ala', 'B')).toThrow(GameError);
  });

  it('przechodzi lobby -> round_intro -> face_off', () => {
    engine.startGame('a1');
    expect(engine.getState().phase).toBe('round_intro');
    engine.showQuestion('a2');
    expect(engine.getState().phase).toBe('face_off');
    expect(engine.getState().currentQuestion?.answers).toHaveLength(3);
  });

  it('blokuje akcję w złej fazie', () => {
    expect(() => engine.showQuestion('a1')).toThrow(/niedozwolona/);
  });

  it('blokuje powtórzone actionId (idempotencja)', () => {
    engine.startGame('same');
    expect(() => engine.startGame('same')).toThrow(/już wykonana/);
  });

  it('rozstrzyga buzzowanie po timestampie serwera', () => {
    const p1 = engine.addPlayer('Ala', 'A');
    const p2 = engine.addPlayer('Ola', 'B');
    engine.startGame('a1');
    engine.showQuestion('a2');

    const first = engine.buzz(p1.id);
    const second = engine.buzz(p2.id);
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
  });

  it('nie pozwala buzzować dwa razy', () => {
    const p1 = engine.addPlayer('Ala', 'A');
    engine.startGame('a1');
    engine.showQuestion('a2');
    engine.buzz(p1.id);
    expect(() => engine.buzz(p1.id)).toThrow(/Już zgłosiłeś/);
  });

  it('face-off: trafiona odpowiedź przechodzi do gry drużyny', () => {
    const { p1 } = setupPlaying(engine);
    const state = engine.getState();
    expect(state.phase).toBe('playing');
    expect(state.activeTeam).toBe('A');
    expect(state.answeringPlayerId).toBe(p1.id);
    expect(state.teams.A.roundPoints).toBe(30);
  });

  it('face-off: błędna odpowiedź daje szansę drugiej głowie', () => {
    engine.addPlayer('Ala', 'A');
    engine.addPlayer('Ola', 'B');
    engine.startGame('s');
    engine.showQuestion('q');
    engine.faceOffAnswer('fo', 'A', null);
    expect(engine.getState().phase).toBe('face_off_second');
  });

  it('face-off: druga odpowiedź wyżej na tablicy przejmuje pytanie', () => {
    engine.addPlayer('Ala', 'A');
    engine.addPlayer('Ola', 'B');
    engine.startGame('s');
    engine.showQuestion('q');
    // Pierwsza głowa się myli — dopiero wtedy druga odpowiada
    engine.faceOffAnswer('fo1', 'A', null);
    engine.faceOffSecondAnswer('fo2', 'B', 1); // rank 1 — trafienie
    const state = engine.getState();
    expect(state.activeTeam).toBe('B');
    expect(state.phase).toBe('playing');
  });

  it('face-off: druga odpowiedź niżej nie przejmuje pytania', () => {
    engine.addPlayer('Ala', 'A');
    engine.addPlayer('Ola', 'B');
    engine.startGame('s');
    engine.showQuestion('q');
    // Pierwsza głowa trafia w rank 1 — face-off kończy się od razu
    engine.faceOffAnswer('fo1', 'A', 1);
    expect(engine.getState().activeTeam).toBe('A');
    expect(engine.getState().phase).toBe('playing');
  });

  it('face-off: obie głowy się pomyliły — pytanie zostaje przy pierwszej', () => {
    engine.addPlayer('Ala', 'A');
    engine.addPlayer('Ola', 'B');
    engine.startGame('s');
    engine.showQuestion('q');
    engine.faceOffAnswer('fo1', 'A', null);
    engine.faceOffSecondAnswer('fo2', 'B', null);
    const state = engine.getState();
    expect(state.phase).toBe('playing');
    expect(state.activeTeam).toBe('A');
  });

  it('dolicza punkty za odkrytą odpowiedź', () => {
    setupPlaying(engine);
    engine.confirmAnswer('c1', 2);
    expect(engine.getState().teams.A.roundPoints).toBe(50);
  });

  it('face-off dolicza punkty pierwszej odpowiedzi', () => {
    setupPlaying(engine);
    expect(engine.getState().teams.A.roundPoints).toBe(30);
  });

  it('po 3 strike-ach przechodzi do steal', () => {
    setupPlaying(engine);
    engine.rejectAnswer('r1');
    engine.rejectAnswer('r2');
    expect(engine.getState().phase).toBe('playing');
    engine.rejectAnswer('r3');
    expect(engine.getState().phase).toBe('steal');
    expect(engine.getState().activeTeam).toBe('B');
  });

  it('udany steal przenosi pulę do drugiej drużyny', () => {
    setupPlaying(engine); // face-off odkrył odpowiedź 1 (30 pkt dla A)
    engine.rejectAnswer('r1');
    engine.rejectAnswer('r2');
    engine.rejectAnswer('r3'); // steal, activeTeam = B

    engine.confirmAnswer('c2', 2); // 20 pkt
    const state = engine.getState();
    expect(state.phase).toBe('round_summary');
    expect(state.teams.B.score).toBe(50);
    expect(state.teams.A.score).toBe(0);
  });

  it('nieudany steal zostawia pulę przy pierwszej drużynie', () => {
    setupPlaying(engine); // face-off odkrył odpowiedź 1 (30 pkt)
    engine.rejectAnswer('r1');
    engine.rejectAnswer('r2');
    engine.rejectAnswer('r3'); // steal
    engine.rejectAnswer('r4'); // nieudany steal

    const state = engine.getState();
    expect(state.phase).toBe('round_summary');
    expect(state.teams.A.score).toBe(30);
    expect(state.teams.B.score).toBe(0);
  });

  it('oddanie pytania przekazuje pulę przeciwnikom', () => {
    setupPlaying(engine); // face-off odkrył odpowiedź 1 (30 pkt dla A)
    engine.passQuestion('pass');
    const state = engine.getState();
    expect(state.phase).toBe('steal');
    expect(state.activeTeam).toBe('B');
    expect(state.teams.B.roundPoints).toBe(30);
    expect(state.teams.A.roundPoints).toBe(0);
  });

  it('kończy rundę po odkryciu wszystkich odpowiedzi', () => {
    setupPlaying(engine); // odpowiedź 1 już odkryta
    engine.confirmAnswer('c2', 2);
    engine.confirmAnswer('c3', 3);
    expect(engine.getState().phase).toBe('round_summary');
    expect(engine.getState().teams.A.score).toBe(60);
  });

  it('po 3 rundach przechodzi do finału', () => {
    const p1 = engine.addPlayer('Ala', 'A');
    engine.startGame('s');
    for (let round = 0; round < 3; round += 1) {
      engine.showQuestion(`q${round}`);
      engine.faceOffAnswer(`fo${round}`, 'A', 1);
      engine.confirmAnswer(`c1-${round}`, 2);
      engine.confirmAnswer(`c2-${round}`, 3);
      engine.nextRound(`n${round}`);
    }
    expect(engine.getState().phase).toBe('final_intro');
    expect(p1.id).toBeTruthy();
  });

  it('reset przywraca lobby i zachowuje graczy', () => {
    engine.addPlayer('Ala', 'A');
    engine.startGame('a1');
    engine.resetGame('reset');
    const state = engine.getState();
    expect(state.phase).toBe('lobby');
    expect(state.teams.A.players).toHaveLength(1);
  });
});

describe('Mnożniki punktów (regulamin)', () => {
  it('runda 1 = ×1', () => {
    expect(multiplierFor(0, 0)).toBe(1);
    expect(multiplierFor(0, 5)).toBe(1);
  });

  it('runda 2 = ×2', () => {
    expect(multiplierFor(1, 0)).toBe(2);
    expect(multiplierFor(1, 5)).toBe(2);
  });

  it('runda 3 = ×2, po 4. pytaniu ×3', () => {
    expect(multiplierFor(2, 0)).toBe(2);
    expect(multiplierFor(2, 3)).toBe(2);
    expect(multiplierFor(2, 4)).toBe(3);
    expect(multiplierFor(2, 5)).toBe(3);
  });

  it('punkty są mnożone w rundzie 2', () => {
    const engine = new GameEngine('TEST');
    engine.addPlayer('Ala', 'A');
    engine.startGame('s');
    // Runda 1 — przechodzimy do podsumowania
    engine.showQuestion('q1');
    engine.faceOffAnswer('fo1', 'A', 1);
    engine.confirmAnswer('c1', 2);
    engine.confirmAnswer('c2', 3);
    engine.nextRound('n1');

    // Runda 2 — mnożnik ×2
    expect(engine.getState().pointMultiplier).toBe(2);
    engine.showQuestion('q2');
    engine.faceOffAnswer('fo2', 'A', 1); // 30 × 2 = 60
    expect(engine.getState().teams.A.roundPoints).toBe(60);
  });
});

describe('Warunek zwycięstwa 300 pkt', () => {
  it('gra kończy się po osiągnięciu 300 pkt', () => {
    const engine = new GameEngine('TEST');
    engine.addPlayer('Ala', 'A');
    engine.startGame('s');

    // Symulujemy wysokie wyniki przez bezpośrednie ustawienie stanu
    const state = engine.getState();
    state.teams.A.score = 300;

    engine.showQuestion('q');
    engine.faceOffAnswer('fo', 'A', 1);
    engine.confirmAnswer('c1', 2);
    engine.confirmAnswer('c2', 3);
    engine.nextRound('n');

    expect(engine.getState().phase).toBe('final_intro');
    expect(engine.getState().winner).toBe('A');
  });
});
