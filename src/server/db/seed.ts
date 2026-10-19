import fs from 'node:fs';
import { SEED_PATH } from '../config.js';
import type { QuestionInput } from '../../shared/types.js';
import { getDb } from './connection.js';
import { countQuestions, createQuestion } from './questions.repo.js';

interface SeedFile {
  questions: QuestionInput[];
}

/**
 * Importuje pytania z data/seed/questions.json, jeśli baza jest pusta.
 * Idempotentne — nie duplikuje pytań przy kolejnych startach.
 */
export function seedIfEmpty(): number {
  if (countQuestions() > 0) return 0;
  if (!fs.existsSync(SEED_PATH)) {
    console.warn(`[seed] Brak pliku seed: ${SEED_PATH}`);
    return 0;
  }

  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw) as SeedFile;
  if (!Array.isArray(parsed.questions)) {
    throw new Error('[seed] Nieprawidłowy format pliku seed (brak tablicy questions)');
  }

  // Transakcja — import setek pytań jest znacznie szybszy.
  const db = getDb();
  let imported = 0;
  const run = db.transaction(() => {
    for (const q of parsed.questions) {
      createQuestion(q);
      imported += 1;
    }
  });
  run();

  console.log(`[seed] Zaimportowano ${imported} pytań`);
  return imported;
}
