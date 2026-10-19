import type { GameState } from '../../shared/types.js';
import { generateRoomCode } from '../config.js';
import { createGame, logEvent, saveSnapshot } from '../db/games.repo.js';
import { createDemoBots, startDemo, type DemoBot } from '../game/demo.js';
import { GameEngine } from '../game/engine.js';

export interface Room {
  code: string;
  engine: GameEngine;
  gameId: number;
  eventSeq: number;
  createdAt: number;
  isDemo: boolean;
  bots: DemoBot[];
  stopDemo: (() => void) | null;
  /** Wywoływane po każdej zmianie stanu — używane do broadcastu Socket.IO. */
  onStateChange: ((state: GameState) => void) | null;
}

const rooms = new Map<string, Room>();

function buildRoom(code: string, isDemo: boolean): Room {
  let room: Room;
  const engine = new GameEngine(
    code,
    {
      onChange: (state: GameState, eventType: string) => {
        if (!room) return;
        room.eventSeq += 1;
        saveSnapshot(room.gameId, state);
        logEvent(room.gameId, room.eventSeq, eventType, {
          phase: state.phase,
          version: state.version,
        });
        room.onStateChange?.(state);
      },
    },
    isDemo ? { isDemo: true, teamAName: 'Drużyna Niebieskich', teamBName: 'Drużyna Czerwonych' } : undefined
  );

  const gameId = createGame(engine.getState());
  room = {
    code,
    engine,
    gameId,
    eventSeq: 0,
    createdAt: Date.now(),
    isDemo,
    bots: [],
    stopDemo: null,
    onStateChange: null,
  };
  return room;
}

export function createRoom(): Room {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();
  const room = buildRoom(code, false);
  rooms.set(code, room);
  return room;
}

/**
 * Tworzy pokój demo z botami i automatycznie uruchamia rozgrywkę.
 * Boty startują dopiero po podłączeniu pierwszego klienta (TV/host),
 * aby widz nie przegapił początku.
 */
export function createDemoRoom(): Room {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const room = buildRoom(code, true);
  room.bots = createDemoBots(room.engine);
  rooms.set(code, room);
  return room;
}

/** Uruchamia boty w pokoju demo (idempotentne). */
export function startDemoIfNeeded(room: Room): void {
  if (!room.isDemo || room.stopDemo) return;
  room.stopDemo = startDemo(room.engine, room.bots, (state) => {
    room.onStateChange?.(state);
  });
}

export function getRoom(code: string): Room | null {
  return rooms.get(code.toUpperCase()) ?? null;
}

export function getOrCreateRoom(code?: string): Room {
  if (code) {
    const existing = getRoom(code);
    if (existing) return existing;
  }
  return createRoom();
}

export function listRooms(): Room[] {
  return [...rooms.values()];
}
