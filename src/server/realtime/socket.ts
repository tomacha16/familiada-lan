import type { Server, Socket } from 'socket.io';
import type {
  AckResult,
  AuthPayload,
  ClientToServerEvents,
  GameState,
  JoinResult,
  ServerToClientEvents,
  SubmitAnswerResult,
  TeamId,
} from '../../shared/types.js';
import { GameError } from '../game/engine.js';
import { matchAnswers } from '../match/fuzzy.js';
import { validateAuth } from './auth.js';
import { getOrCreateRoom, getRoom, startDemoIfNeeded, type Room } from './rooms.js';

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketData {
  role: AuthPayload['role'];
  roomCode: string;
  playerId?: string;
}

function roomChannel(code: string): string {
  return `room:${code}`;
}

function broadcastState(io: GameServer, room: Room): void {
  io.to(roomChannel(room.code)).emit('state:sync', room.engine.getState());
}

function broadcastPlayers(io: GameServer, room: Room): void {
  const state = room.engine.getState();
  const players = [...state.teams.A.players, ...state.teams.B.players];
  io.to(roomChannel(room.code)).emit('room:players', players);
}

function ok(): AckResult {
  return { ok: true };
}

function fail(error: unknown): AckResult {
  if (error instanceof GameError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : 'Nieznany błąd';
  return { ok: false, error: { code: 'INTERNAL', message } };
}

/** Rejestruje wszystkie handlery Socket.IO. */
export function registerSocketHandlers(io: GameServer): void {
  io.use((socket, next) => {
    const result = validateAuth(socket.handshake.auth);
    if (!result.ok) {
      next(new Error(result.error ?? 'Brak autoryzacji'));
      return;
    }
    const auth = socket.handshake.auth as AuthPayload;
    const data = socket.data as SocketData;
    data.role = auth.role;
    data.roomCode = auth.roomCode.toUpperCase();
    data.playerId = auth.playerId;
    next();
  });

  io.on('connection', (socket: GameSocket) => {
    const data = socket.data as SocketData;
    const room = getOrCreateRoom(data.roomCode);
    data.roomCode = room.code;

    socket.join(roomChannel(room.code));
    socket.join(`${roomChannel(room.code)}:${data.role}`);

    // Reconnect gracza
    if (data.role === 'player' && data.playerId) {
      room.engine.setPlayerConnected(data.playerId, true);
    }

    // Tryb demo: broadcast zmian stanu do wszystkich klientów pokoju
    if (room.isDemo) {
      room.onStateChange = (state) => {
        io.to(roomChannel(room.code)).emit('state:sync', state);
      };
      // Boty startują, gdy pierwszy widz (TV/host) się podłączy
      if (data.role === 'tv' || data.role === 'host') {
        startDemoIfNeeded(room);
      }
    }

    socket.emit('state:sync', room.engine.getState());
    broadcastPlayers(io, room);

    socket.on('player:join', (payload, ack) => {
      try {
        const player = room.engine.addPlayer(payload.name, payload.team);
        data.playerId = player.id;
        const result: JoinResult = {
          ok: true,
          playerId: player.id,
          state: room.engine.getState(),
        };
        ack?.(result);
        broadcastState(io, room);
        broadcastPlayers(io, room);
      } catch (error) {
        const result = fail(error);
        ack?.({ ...result });
        socket.emit('game:error', result.error!);
      }
    });

    socket.on('player:buzz', (payload, ack) => {
      try {
        if (!data.playerId) throw new GameError('NOT_JOINED', 'Najpierw dołącz do gry');
        const { position } = room.engine.buzz(data.playerId);
        socket.emit('buzz:registered', { playerId: data.playerId, position });
        ack?.(ok());
        broadcastState(io, room);
      } catch (error) {
        const result = fail(error);
        ack?.(result);
        socket.emit('game:error', result.error!);
      }
    });

    /* ------------------------- akcje hosta ------------------------- */

    const hostAction = <P>(
      event: string,
      handler: (payload: P) => void
    ): void => {
      socket.on(event as never, ((payload: P, ack?: (res: AckResult) => void) => {
        try {
          if (data.role !== 'host') throw new GameError('FORBIDDEN', 'Wymagana rola hosta');
          handler(payload);
          ack?.(ok());
          broadcastState(io, room);
          broadcastPlayers(io, room);
        } catch (error) {
          const result = fail(error);
          ack?.(result);
          socket.emit('game:error', result.error!);
        }
      }) as never);
    };

    hostAction<{ actionId: string }>('host:startGame', (p) => room.engine.startGame(p.actionId));
    hostAction<{ actionId: string }>('host:showQuestion', (p) => room.engine.showQuestion(p.actionId));
    hostAction<{ actionId: string; team: TeamId; playerId: string }>('host:setFamilyHead', (p) =>
      room.engine.setFamilyHead(p.actionId, p.team, p.playerId)
    );
    hostAction<{ actionId: string; team: TeamId; answerId: number | null }>(
      'host:faceOffAnswer',
      (p) => room.engine.faceOffAnswer(p.actionId, p.team, p.answerId)
    );
    hostAction<{ actionId: string; team: TeamId; answerId: number | null }>(
      'host:faceOffSecondAnswer',
      (p) => room.engine.faceOffSecondAnswer(p.actionId, p.team, p.answerId)
    );
    hostAction<{ actionId: string; playerId: string }>('host:selectAnswerer', (p) =>
      room.engine.selectAnswerer(p.actionId, p.playerId)
    );
    hostAction<{ actionId: string; answerId: number }>('host:confirmAnswer', (p) =>
      room.engine.confirmAnswer(p.actionId, p.answerId)
    );
    hostAction<{ actionId: string }>('host:rejectAnswer', (p) => room.engine.rejectAnswer(p.actionId));
    hostAction<{ actionId: string }>('host:passQuestion', (p) => room.engine.passQuestion(p.actionId));
    hostAction<{ actionId: string }>('host:nextRound', (p) => room.engine.nextRound(p.actionId));
    hostAction<{
      actionId: string;
      team: TeamId;
      firstPlayer: { id: string | null; name: string };
      secondPlayer: { id: string | null; name: string };
    }>('host:startFinal', (p) =>
      room.engine.startFinal(p.actionId, p.team, p.firstPlayer, p.secondPlayer)
    );
    hostAction<{ actionId: string; text: string }>('host:submitFinalAnswer', (p) =>
      room.engine.submitFinalAnswer(p.actionId, p.text)
    );
    hostAction<{ actionId: string }>('host:skipFinalQuestion', (p) =>
      room.engine.skipFinalQuestion(p.actionId)
    );
    hostAction<{ actionId: string }>('host:finishFinalPlayer', (p) =>
      room.engine.finishFinalPlayer(p.actionId)
    );
    hostAction<{ actionId: string; matches: Array<Array<number | null>> }>('host:revealFinal', (p) =>
      room.engine.revealFinal(p.actionId, p.matches)
    );
    hostAction<{ actionId: string }>('host:endGame', (p) => room.engine.endGame(p.actionId));
    hostAction<{ actionId: string }>('host:resetGame', (p) => room.engine.resetGame(p.actionId));
    hostAction<{ actionId: string; config: GameState['config'] }>('host:updateConfig', (p) =>
      room.engine.updateConfig(p.actionId, p.config)
    );

    // Wpisanie odpowiedzi: zwraca podpowiedzi fuzzy (nie zmienia stanu gry)
    socket.on('host:submitAnswer', (payload, ack) => {
      try {
        if (data.role !== 'host') throw new GameError('FORBIDDEN', 'Wymagana rola hosta');
        const state = room.engine.getState();
        const question = state.currentQuestion;
        if (!question) throw new GameError('NO_QUESTION', 'Brak aktywnego pytania');

        const matches = matchAnswers(payload.text, question.answers);
        const result: SubmitAnswerResult = { ok: true, matches };
        ack?.(result);
        socket.emit('answer:suggestions', { matches });
      } catch (error) {
        const result = fail(error);
        ack?.({ ...result });
        socket.emit('game:error', result.error!);
      }
    });

    socket.on('disconnect', () => {
      if (data.role === 'player' && data.playerId) {
        const current = getRoom(data.roomCode);
        if (current) {
          current.engine.setPlayerConnected(data.playerId, false);
          broadcastPlayers(io, current);
        }
      }
    });
  });
}
