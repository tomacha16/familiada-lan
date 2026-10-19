import http from 'node:http';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
import { gamesRouter } from './api/games.routes.js';
import { questionsRouter } from './api/questions.routes.js';
import { HOST_PIN, PORT, PUBLIC_DIR } from './config.js';
import { closeDb } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { seedIfEmpty } from './db/seed.js';
import { buildBaseUrl, buildJoinUrl, getLanAddresses } from './network.js';
import { registerSocketHandlers } from './realtime/socket.js';
import { createDemoRoom, createRoom, getOrCreateRoom } from './realtime/rooms.js';

function bootstrap(): void {
  runMigrations();
  seedIfEmpty();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/questions', questionsRouter());
  app.use('/api/games', gamesRouter());

  // Informacje o serwerze (używane przez klienty do budowy QR)
  app.get('/api/server-info', (_req, res) => {
    res.json({
      baseUrl: buildBaseUrl(PORT),
      addresses: getLanAddresses(),
      port: PORT,
    });
  });

  // QR jako PNG dla kodu pokoju
  app.get('/api/qr', async (req, res) => {
    const room = typeof req.query.room === 'string' ? req.query.room : '';
    if (!room) {
      res.status(400).json({ error: 'Brak parametru room' });
      return;
    }
    try {
      const url = buildJoinUrl(PORT, room.toUpperCase());
      const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
      res.type('png').send(png);
    } catch {
      res.status(500).json({ error: 'Nie udało się wygenerować QR' });
    }
  });

  // Utworzenie pokoju (panel hosta)
  app.post('/api/rooms', (_req, res) => {
    const room = createRoom();
    res.status(201).json({
      roomCode: room.code,
      joinUrl: buildJoinUrl(PORT, room.code),
      tvUrl: `${buildBaseUrl(PORT)}/tv?room=${room.code}`,
    });
  });

  // Utworzenie pokoju demo (boty grają automatycznie)
  app.post('/api/demo', (_req, res) => {
    const room = createDemoRoom();
    res.status(201).json({
      roomCode: room.code,
      isDemo: true,
      tvUrl: `${buildBaseUrl(PORT)}/tv?room=${room.code}`,
      hostUrl: `${buildBaseUrl(PORT)}/host?room=${room.code}`,
    });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const room = getOrCreateRoom(req.params.code);
    res.json({ roomCode: room.code, state: room.engine.getState() });
  });

  // Statyczne PWA
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  // Routing SPA-like dla klientów
  app.get('/tv', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tv', 'index.html')));
  app.get('/join', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player', 'index.html')));
  app.get('/host', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host', 'index.html')));

  // Tryb demo: tworzy pokój z botami i przekierowuje na tablicę TV
  app.get('/demo', (_req, res) => {
    const room = createDemoRoom();
    res.redirect(`/tv?room=${room.code}&demo=1`);
  });

  const server = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: true },
  });
  registerSocketHandlers(io);

  server.listen(PORT, '0.0.0.0', () => {
    const base = buildBaseUrl(PORT);
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║              FAMILIADA LAN                   ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log(`  Serwer:      ${base}`);
    console.log(`  TV:          ${base}/tv`);
    console.log(`  Gracz:       ${base}/join`);
    console.log(`  Host:        ${base}/host`);
    console.log(`  PIN hosta:   ${HOST_PIN}`);
    console.log('');
  });

  const shutdown = (): void => {
    console.log('\nZamykanie serwera...');
    io.close();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
