import { describe, expect, it } from 'vitest';
import type { AnswerState } from '../src/shared/types.js';
import { matchAnswers, similarity } from '../src/server/match/fuzzy.js';
import { comparisonKey, normalize, stemWord } from '../src/server/match/normalize.js';

const answers: AnswerState[] = [
  { answerId: 1, text: 'ręcznik', points: 32, rank: 1, revealed: false },
  { answerId: 2, text: 'krem do opalania', points: 24, rank: 2, revealed: false },
  { answerId: 3, text: 'okulary przeciwsłoneczne', points: 18, rank: 3, revealed: false },
  { answerId: 4, text: 'parasol', points: 12, rank: 4, revealed: false },
];

describe('normalize', () => {
  it('usuwa diakrytyki i interpunkcję', () => {
    expect(normalize('Ręcznik!')).toBe('recznik');
    expect(normalize('  Krem   do opalania. ')).toBe('krem do opalania');
  });

  it('stemmuje końcówki fleksyjne', () => {
    expect(stemWord('recznik')).toBe('recznik');
    expect(stemWord('okulary')).toBe('okular');
    expect(stemWord('parasolami')).toBe('parasol');
  });

  it('buduje klucz porównawczy', () => {
    expect(comparisonKey('Ręczniki')).toBe(comparisonKey('recznik'));
  });
});

describe('similarity', () => {
  it('daje 1.0 dla identycznych po normalizacji', () => {
    expect(similarity('recznik', 'ręcznik')).toBe(1);
  });

  it('daje wysoki wynik dla literówki', () => {
    expect(similarity('recznk', 'ręcznik')).toBeGreaterThan(0.75);
  });

  it('daje niski wynik dla niepowiązanych słów', () => {
    expect(similarity('parasol', 'ręcznik')).toBeLessThan(0.5);
  });
});

describe('matchAnswers', () => {
  it('dopasowuje bez polskich znaków', () => {
    const matches = matchAnswers('recznik', answers);
    expect(matches[0]?.answerId).toBe(1);
    expect(matches[0]?.exact).toBe(true);
  });

  it('podpowiada przy literówce', () => {
    const matches = matchAnswers('kremy do opalania', answers);
    expect(matches.some((m) => m.answerId === 2)).toBe(true);
  });

  it('nie zwraca niepowiązanych odpowiedzi', () => {
    const matches = matchAnswers('telewizor', answers);
    expect(matches).toHaveLength(0);
  });

  it('zwraca maksymalnie 3 kandydatów', () => {
    const many: AnswerState[] = Array.from({ length: 10 }, (_, i) => ({
      answerId: i + 1,
      text: 'parasol',
      points: 10,
      rank: i + 1,
      revealed: false,
    }));
    expect(matchAnswers('parasol', many).length).toBeLessThanOrEqual(3);
  });
});
