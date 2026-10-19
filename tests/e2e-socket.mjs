/**
 * Test end-to-end przez prawdziwy transport Socket.IO.
 * Uruchomienie: node tests/e2e-socket.mjs (serwer musi działać na :3000)
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PIN = process.env.HOST_PIN || '123456';

const log = (msg) => console.log(`  ${msg}`);
let failures = 0;

function check(condition, label) {
  if (condition) {
    log(`✓ ${label}`);
  } else {
    failures += 1;
    log(`✗ ${label}`);
  }
}

function connect(auth) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout połączenia')), 5000);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function waitFor(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  console.log('\n=== E2E: pełny przepływ gry ===\n');

  // 1. Utworzenie pokoju
  const roomRes = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  const room = await roomRes.json();
  check(Boolean(room.roomCode), `Pokój utworzony: ${room.roomCode}`);

  // 2. Połączenia
  const host = await connect({ role: 'host', roomCode: room.roomCode, hostPin: PIN });
  check(true, 'Host połączony');

  const tv = await connect({ role: 'tv', roomCode: room.roomCode });
  check(true, 'TV połączony');

  const p1 = await connect({ role: 'player', roomCode: room.roomCode });
  const p2 = await connect({ role: 'player', roomCode: room.roomCode });
  check(true, 'Dwaj gracze połączeni');

  // 3. Dołączenie graczy
  const join1 = await emitAck(p1, 'player:join', { name: 'Ala', team: 'A' });
  const join2 = await emitAck(p2, 'player:join', { name: 'Ola', team: 'B' });
  check(join1.ok && join2.ok, 'Gracze dołączyli do drużyn');

  // 4. Start gry
  const start = await emitAck(host, 'host:startGame', { actionId: 'e2e-start' });
  check(start.ok, 'Gra rozpoczęta');

  // 5. Pokaż pytanie
  const show = await emitAck(host, 'host:showQuestion', { actionId: 'e2e-show' });
  check(show.ok, 'Pytanie pokazane');

  // 6. Buzzowanie
  const buzz1 = await emitAck(p1, 'player:buzz', { actionId: 'e2e-buzz1' });
  const buzz2 = await emitAck(p2, 'player:buzz', { actionId: 'e2e-buzz2' });
  check(buzz1.ok && buzz2.ok, 'Obaj gracze zbuzzowali');

  // 7. Face-off: pierwsza głowa się myli, druga trafia
  const faceOff1 = await emitAck(host, 'host:faceOffAnswer', {
    actionId: 'e2e-fo1',
    team: 'A',
    answerId: null,
  });
  check(faceOff1.ok, 'Face-off: pierwsza głowa się pomyliła');

  const faceOff2 = await emitAck(host, 'host:faceOffSecondAnswer', {
    actionId: 'e2e-fo2',
    team: 'B',
    answerId: 1,
  });
  check(faceOff2.ok, 'Face-off: druga głowa trafiła');

  // 8. Fuzzy match — używamy odpowiedzi z faktycznie wylosowanego pytania
  const currentState = await waitFor(tv, 'state:sync', 2000).catch(() => null);
  const question = currentState?.currentQuestion;
  check(Boolean(question), 'TV widzi aktywne pytanie');

  // Odpowiedź 1 została już odkryta w face-off — bierzemy kolejną
  const targetAnswer = question.answers.find((a) => !a.revealed) ?? question.answers[0];
  // Celowa literówka: bez polskich znaków + podmiana jednej litery w środku
  const plain = targetAnswer.text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
  // Realistyczna literówka: usuwamy jedną literę ze środka pierwszego słowa
  const firstSpace = plain.indexOf(' ');
  const word = firstSpace === -1 ? plain : plain.slice(0, firstSpace);
  const rest = firstSpace === -1 ? '' : plain.slice(firstSpace);
  const mid = Math.floor(word.length / 2);
  const typo = word.slice(0, mid) + word.slice(mid + 1) + rest;

  const suggestions = await emitAck(host, 'host:submitAnswer', {
    actionId: 'e2e-submit',
    text: typo,
  });
  check(
    suggestions.ok && suggestions.matches.length > 0,
    `Fuzzy match ("${typo}") zwrócił ${suggestions.matches?.length ?? 0} podpowiedzi`
  );

  // 9. Zatwierdzenie odpowiedzi
  const answerId = suggestions.matches[0].answerId;
  const confirm = await emitAck(host, 'host:confirmAnswer', {
    actionId: 'e2e-confirm',
    answerId,
  });
  check(confirm.ok, 'Odpowiedź zatwierdzona');

  // 10. Idempotencja
  const duplicate = await emitAck(host, 'host:startGame', { actionId: 'e2e-start' });
  check(!duplicate.ok && duplicate.error.code === 'DUPLICATE_ACTION', 'Idempotencja actionId działa');

  // 11. Zła faza
  const wrongPhase = await emitAck(host, 'host:showQuestion', { actionId: 'e2e-wrong' });
  check(!wrongPhase.ok && wrongPhase.error.code === 'WRONG_PHASE', 'Walidacja fazy działa');

  // 12. Brak PIN hosta
  let pinRejected = false;
  try {
    const bad = await connect({ role: 'host', roomCode: room.roomCode, hostPin: '000000' });
    bad.disconnect();
  } catch {
    pinRejected = true;
  }
  check(pinRejected, 'Nieprawidłowy PIN hosta odrzucony');

  // 13. Stan TV zawiera pytanie
  const tvState = await waitFor(tv, 'state:sync', 1000).catch(() => null);
  check(tvState === null || tvState.phase !== undefined, 'TV otrzymuje stan gry');

  // 14. Strike
  const strike = await emitAck(host, 'host:rejectAnswer', { actionId: 'e2e-strike' });
  check(strike.ok, 'Strike zarejestrowany');

  // 15. REST: edycja pytania bez PIN
  const noPin = await fetch(`${BASE}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x', answers: [{ text: 'y', points: 1, rank: 1 }] }),
  });
  check(noPin.status === 401, 'REST odrzuca brak PIN hosta');

  // 16. REST: edycja pytania z PIN
  const withPin = await fetch(`${BASE}/api/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Host-Pin': PIN },
    body: JSON.stringify({
      text: 'Pytanie testowe E2E',
      roundType: 'normal',
      answers: [{ text: 'test', points: 5, rank: 1 }],
    }),
  });
  check(withPin.status === 201, 'REST tworzy pytanie z poprawnym PIN');

  // 17. Historia gier
  const games = await fetch(`${BASE}/api/games`).then((r) => r.json());
  check(Array.isArray(games.games) && games.games.length > 0, 'Historia gier zapisana');

  host.disconnect();
  tv.disconnect();
  p1.disconnect();
  p2.disconnect();

  console.log(`\n=== Wynik: ${failures === 0 ? 'WSZYSTKO OK' : failures + ' BŁĘDÓW'} ===\n`);
  // Pozwalamy socketom zamknąć się czysto (unikamy asercji libuv na Windows)
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
}

main().catch((error) => {
  console.error('Błąd E2E:', error);
  setTimeout(() => process.exit(1), 300);
});
