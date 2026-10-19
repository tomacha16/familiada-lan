import { distance } from 'fastest-levenshtein';
import type { AnswerState, MatchResult } from '../../shared/types.js';
import { comparisonKey, tokenize } from './normalize.js';

const THRESHOLD = 0.75;
const MAX_SUGGESTIONS = 3;

function levenshteinScore(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

function jaccardScore(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Łączny wynik: 60% Levenshtein + 40% Jaccard na tokenach.
 * Dla pojedynczych słów Jaccard jest bezużyteczny (0 lub 1), więc
 * wynik opiera się wtedy wyłącznie na Levenshteinie.
 */
export function similarity(input: string, candidate: string): number {
  const aKey = comparisonKey(input);
  const bKey = comparisonKey(candidate);
  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;

  const lev = levenshteinScore(aKey, bKey);
  const aTokens = tokenize(input);
  const bTokens = tokenize(candidate);

  // Jedno słowo po obu stronach — Jaccard nie wnosi informacji.
  if (aTokens.length === 1 && bTokens.length === 1) return lev;

  const jac = jaccardScore(aTokens, bTokens);
  return 0.6 * lev + 0.4 * jac;
}

/**
 * Dopasowuje wpis hosta do listy odpowiedzi pytania.
 * Zwraca posortowane kandydaty powyżej progu (max 3).
 */
export function matchAnswers(input: string, answers: AnswerState[]): MatchResult[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const results: MatchResult[] = [];

  for (const answer of answers) {
    const candidates = [answer.text];
    // Aliasy nie są częścią AnswerState — dopasowanie po tekście głównym.
    let best = 0;
    let exact = false;
    for (const candidate of candidates) {
      const score = similarity(trimmed, candidate);
      if (score > best) best = score;
      if (comparisonKey(trimmed) === comparisonKey(candidate)) exact = true;
    }

    if (exact || best >= THRESHOLD) {
      results.push({
        answerId: answer.answerId,
        text: answer.text,
        points: answer.points,
        rank: answer.rank,
        score: Number(best.toFixed(3)),
        exact,
      });
    }
  }

  return results
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}

/** Wariant uwzględniający aliasy (używany przy dopasowaniu finałowym). */
export function matchAnswersWithAliases(
  input: string,
  answers: AnswerState[],
  aliasesByAnswerId: Map<number, string[]>
): MatchResult[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const results: MatchResult[] = [];
  for (const answer of answers) {
    const candidates = [answer.text, ...(aliasesByAnswerId.get(answer.answerId) ?? [])];
    let best = 0;
    let exact = false;
    for (const candidate of candidates) {
      const score = similarity(trimmed, candidate);
      if (score > best) best = score;
      if (comparisonKey(trimmed) === comparisonKey(candidate)) exact = true;
    }
    if (exact || best >= THRESHOLD) {
      results.push({
        answerId: answer.answerId,
        text: answer.text,
        points: answer.points,
        rank: answer.rank,
        score: Number(best.toFixed(3)),
        exact,
      });
    }
  }

  return results
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}
