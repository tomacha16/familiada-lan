import { timingSafeEqual } from 'node:crypto';
import { HOST_PIN } from '../config.js';
import type { AuthPayload } from '../../shared/types.js';

export interface AuthResult {
  ok: boolean;
  error?: string;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Waliduje payload handshake Socket.IO. */
export function validateAuth(payload: unknown): AuthResult {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Brak danych uwierzytelniania' };
  }
  const auth = payload as Partial<AuthPayload>;

  if (auth.role !== 'tv' && auth.role !== 'player' && auth.role !== 'host') {
    return { ok: false, error: 'Nieprawidłowa rola' };
  }
  if (!auth.roomCode || typeof auth.roomCode !== 'string') {
    return { ok: false, error: 'Brak kodu pokoju' };
  }
  if (auth.role === 'host') {
    if (!auth.hostPin || !safeEqual(auth.hostPin, HOST_PIN)) {
      return { ok: false, error: 'Nieprawidłowy PIN hosta' };
    }
  }
  return { ok: true };
}

/** Middleware Express dla endpointów edycyjnych. */
export function requireHostPin(pin: string | undefined): boolean {
  if (!pin) return false;
  return safeEqual(pin, HOST_PIN);
}
