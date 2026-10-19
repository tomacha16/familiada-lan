import { getDb } from './connection.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text          TEXT NOT NULL,
  category      TEXT,
  round_type    TEXT NOT NULL DEFAULT 'normal',
  difficulty    INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  points        INTEGER NOT NULL,
  rank          INTEGER NOT NULL,
  aliases       TEXT NOT NULL DEFAULT '[]',
  UNIQUE (question_id, rank)
);

CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code     TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  team_a_name   TEXT NOT NULL,
  team_b_name   TEXT NOT NULL,
  team_a_score  INTEGER NOT NULL DEFAULT 0,
  team_b_score  INTEGER NOT NULL DEFAULT 0,
  state_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(is_active, round_type);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON game_events(game_id, seq);
`;

export function runMigrations(): void {
  getDb().exec(SCHEMA);
}
