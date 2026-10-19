/**
 * Test E2E trybu demo: boty powinny same rozgrywać grę.
 * Uruchomienie: node tests/e2e-demo.mjs (serwer musi działać na :3000)
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

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

async function main() {
  console.log('\n=== E2E: tryb demo ===\n');

  // 1. Endpoint /api/demo tworzy pokój
  const res = await fetch(`${BASE}/api/demo`, { method: 'POST' });
  const demo = await res.json();
  check(res.status === 201 && Boolean(demo.roomCode), `Pokój demo utworzony: ${demo.roomCode}`);
  check(demo.isDemo === true, 'Odpowiedź oznaczona jako demo');

  // 2. TV podłącza się — to uruchamia boty
  const tv = await connect({ role: 'tv', roomCode: demo.roomCode });
  check(true, 'TV połączony');

  const initialState = await new Promise((resolve) => {
    tv.once('state:sync', resolve);
    setTimeout(() => resolve(null), 2000);
  });
  check(initialState !== null, 'TV otrzymał stan początkowy');
  check(initialState?.config?.isDemo === true, 'Stan ma flagę isDemo');
  check(
    initialState?.teams?.A?.players?.length === 3 && initialState?.teams?.B?.players?.length === 3,
    'W pokoju jest 6 botów (3 na drużynę)'
  );

  // 3. Zbieramy stany przez kilka sekund — boty powinny rozgrywać grę
  const phases = new Set();
  const versions = [];
  let lastState = initialState;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 12000);
    tv.on('state:sync', (state) => {
      phases.add(state.phase);
      versions.push(state.version);
      lastState = state;
      if (state.phase === 'game_over') {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  check(phases.size > 1, `Boty zmieniają fazy gry (widziano: ${[...phases].join(', ')})`);
  check(versions.length > 3, `Otrzymano ${versions.length} aktualizacji stanu`);
  check(
    phases.has('face_off') || phases.has('playing') || phases.has('steal'),
    'Boty dotarły do fazy rozgrywki'
  );

  // 4. Stan końcowy ma sens
  check(lastState?.version > initialState.version, 'Wersja stanu wzrosła');
  check(
    lastState?.teams?.A?.score >= 0 && lastState?.teams?.B?.score >= 0,
    `Wyniki naliczone (A: ${lastState?.teams?.A?.score}, B: ${lastState?.teams?.B?.score})`
  );

  // 5. Strona /demo przekierowuje na TV
  const redirect = await fetch(`${BASE}/demo`, { redirect: 'manual' });
  check(
    redirect.status === 302 && redirect.headers.get('location')?.includes('/tv?room='),
    '/demo przekierowuje na tablicę TV'
  );

  tv.disconnect();
  console.log(`\n=== Wynik: ${failures === 0 ? 'WSZYSTKO OK' : failures + ' BŁĘDÓW'} ===\n`);
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
}

main().catch((error) => {
  console.error('Błąd E2E demo:', error);
  setTimeout(() => process.exit(1), 300);
});
