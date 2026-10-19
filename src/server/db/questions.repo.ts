import type { AnswerInput, QuestionInput, QuestionRecord } from '../../shared/types.js';
import { getDb } from './connection.js';

interface QuestionRow {
  id: number;
  text: string;
  category: string | null;
  round_type: 'normal' | 'final';
  difficulty: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface AnswerRow {
  id: number;
  question_id: number;
  text: string;
  points: number;
  rank: number;
  aliases: string;
}

function parseAliases(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mapQuestion(row: QuestionRow, answers: AnswerRow[]): QuestionRecord {
  return {
    id: row.id,
    text: row.text,
    category: row.category,
    roundType: row.round_type,
    difficulty: row.difficulty,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answers: answers
      .filter((a) => a.question_id === row.id)
      .sort((a, b) => a.rank - b.rank)
      .map((a) => ({
        text: a.text,
        points: a.points,
        rank: a.rank,
        aliases: parseAliases(a.aliases),
      })),
  };
}

export interface QuestionFilter {
  category?: string;
  roundType?: 'normal' | 'final';
  includeInactive?: boolean;
}

export function listQuestions(filter: QuestionFilter = {}): QuestionRecord[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filter.includeInactive) where.push('is_active = 1');
  if (filter.category) {
    where.push('category = ?');
    params.push(filter.category);
  }
  if (filter.roundType) {
    where.push('round_type = ?');
    params.push(filter.roundType);
  }

  const sql = `SELECT * FROM questions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
  const rows = db.prepare(sql).all(...params) as QuestionRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const answerRows = db
    .prepare(`SELECT * FROM answers WHERE question_id IN (${placeholders})`)
    .all(...ids) as AnswerRow[];

  return rows.map((row) => mapQuestion(row, answerRows));
}

export function getQuestion(id: number): QuestionRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined;
  if (!row) return null;
  const answers = db.prepare('SELECT * FROM answers WHERE question_id = ?').all(id) as AnswerRow[];
  return mapQuestion(row, answers);
}

function validateAnswers(answers: AnswerInput[]): void {
  if (answers.length === 0) throw new Error('Pytanie musi mieć co najmniej jedną odpowiedź');
  const ranks = new Set<number>();
  for (const a of answers) {
    if (!a.text.trim()) throw new Error('Odpowiedź nie może być pusta');
    if (!Number.isInteger(a.points) || a.points <= 0) throw new Error('Punkty muszą być dodatnią liczbą całkowitą');
    if (!Number.isInteger(a.rank) || a.rank <= 0) throw new Error('Rank musi być dodatnią liczbą całkowitą');
    if (ranks.has(a.rank)) throw new Error(`Zduplikowany rank: ${a.rank}`);
    ranks.add(a.rank);
  }
}

function insertAnswers(questionId: number, answers: AnswerInput[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO answers (question_id, text, points, rank, aliases) VALUES (?, ?, ?, ?, ?)'
  );
  for (const a of answers) {
    stmt.run(questionId, a.text.trim(), a.points, a.rank, JSON.stringify(a.aliases ?? []));
  }
}

export function createQuestion(input: QuestionInput): QuestionRecord {
  validateAnswers(input.answers);
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO questions (text, category, round_type, difficulty, is_active)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.text.trim(),
        input.category ?? null,
        input.roundType ?? 'normal',
        input.difficulty ?? 1,
        input.isActive === false ? 0 : 1
      );
    const id = Number(info.lastInsertRowid);
    insertAnswers(id, input.answers);
    return id;
  });
  const id = tx();
  const created = getQuestion(id);
  if (!created) throw new Error('Nie udało się utworzyć pytania');
  return created;
}

export function updateQuestion(id: number, input: QuestionInput): QuestionRecord | null {
  validateAnswers(input.answers);
  const db = getDb();
  const exists = db.prepare('SELECT id FROM questions WHERE id = ?').get(id);
  if (!exists) return null;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE questions
       SET text = ?, category = ?, round_type = ?, difficulty = ?, is_active = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      input.text.trim(),
      input.category ?? null,
      input.roundType ?? 'normal',
      input.difficulty ?? 1,
      input.isActive === false ? 0 : 1,
      id
    );
    db.prepare('DELETE FROM answers WHERE question_id = ?').run(id);
    insertAnswers(id, input.answers);
  });
  tx();
  return getQuestion(id);
}

/** Soft delete — pytanie zostaje w bazie, ale nie jest losowane. */
export function deleteQuestion(id: number): boolean {
  const info = getDb()
    .prepare(`UPDATE questions SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(id);
  return info.changes > 0;
}

export function countQuestions(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM questions').get() as { c: number };
  return row.c;
}

/** Losuje pytania danego typu (bez powtórzeń). */
export function pickRandomQuestions(roundType: 'normal' | 'final', count: number): QuestionRecord[] {
  const all = listQuestions({ roundType });
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, count);
}
