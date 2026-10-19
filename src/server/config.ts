import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Katalog główny projektu (działa zarówno dla src/, jak i dist/). */
export const PROJECT_ROOT = path.resolve(here, '..', '..');

export const PORT = Number(process.env.PORT ?? 3000);

export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'familiada.db');
export const SEED_PATH = path.join(DATA_DIR, 'seed', 'questions.json');

/** PIN hosta: z ENV albo losowy 6-cyfrowy, generowany przy starcie. */
export const HOST_PIN = process.env.HOST_PIN ?? String(randomInt(100000, 1000000));

/**
 * Domyślna konfiguracja gry — zgodna z oficjalnym regulaminem Familiady:
 * 3 rundy, gra do 300 pkt, finał do 200 pkt, 3 sekundy na odpowiedź.
 */
export const DEFAULT_GAME_CONFIG = {
  teamAName: 'Drużyna A',
  teamBName: 'Drużyna B',
  roundsCount: 3,
  gameTargetPoints: 300,
  finalTargetPoints: 200,
  maxStrikes: 3,
  answerTimeLimitSeconds: 3,
} as const;

/** Znaki dozwolone w kodzie pokoju (bez 0/O, 1/I). */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 4): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(0, ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
