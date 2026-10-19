import type { GameState, GameSummary } from '../../shared/types.js';
import { getDb } from './connection.js';

interface GameRow {
  id: number;
  room_code: string;
  started_at: string;
  finished_at: string | null;
  team_a_name: string;
  team_b_name: string;
  team_a_score: number;
  team_b_score: number;
  state_json: string;
}

function mapSummary(row: GameRow): GameSummary {
  return {
    id: row.id,
    roomCode: row.room_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    teamAName: row.team_a_name,
    teamBName: row.team_b_name,
    teamAScore: row.team_a_score,
    teamBScore: row.team_b_score,
  };
}

export function createGame(state: GameState): number {
  const info = getDb()
    .prepare(
      `INSERT INTO games (room_code, team_a_name, team_b_name, team_a_score, team_b_score, state_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      state.roomCode,
      state.teams.A.name,
      state.teams.B.name,
      state.teams.A.score,
      state.teams.B.score,
      JSON.stringify(state)
    );
  return Number(info.lastInsertRowid);
}

/** Zapisuje snapshot stanu gry (wywoływane po zmianie fazy). */
export function saveSnapshot(gameId: number, state: GameState): void {
  getDb()
    .prepare(
      `UPDATE games
       SET state_json = ?, team_a_score = ?, team_b_score = ?,
           finished_at = CASE WHEN ? = 'game_over' THEN datetime('now') ELSE finished_at END
       WHERE id = ?`
    )
    .run(JSON.stringify(state), state.teams.A.score, state.teams.B.score, state.phase, gameId);
}

export function logEvent(gameId: number, seq: number, type: string, payload: unknown): void {
  getDb()
    .prepare('INSERT INTO game_events (game_id, seq, type, payload_json) VALUES (?, ?, ?, ?)')
    .run(gameId, seq, type, JSON.stringify(payload));
}

export function listGames(limit = 50): GameSummary[] {
  const rows = getDb()
    .prepare('SELECT * FROM games ORDER BY id DESC LIMIT ?')
    .all(limit) as GameRow[];
  return rows.map(mapSummary);
}

export function getGameState(gameId: number): GameState | null {
  const row = getDb().prepare('SELECT state_json FROM games WHERE id = ?').get(gameId) as
    | { state_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as GameState;
  } catch {
    return null;
  }
}
