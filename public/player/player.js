import { connect, getRoomCode, keepScreenAwake, showToast } from '/shared/socket-client.js';

const el = (id) => document.getElementById(id);

const STORAGE_KEY = 'familiada.player';

let roomCode = getRoomCode();
let selectedTeam = 'A';
let playerId = null;
let playerName = '';
let socket = null;
let lastState = null;
let hasBuzzed = false;

/* ------------------------- ekran dołączania ------------------------- */

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.roomCode === roomCode) {
      playerId = saved.playerId;
      playerName = saved.name;
      selectedTeam = saved.team;
    }
  } catch {
    /* ignorujemy */
  }
}

function saveSession() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ roomCode, playerId, name: playerName, team: selectedTeam })
  );
}

function selectTeam(team) {
  selectedTeam = team;
  document.querySelectorAll('.team-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.team === team);
  });
}

document.querySelectorAll('.team-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectTeam(btn.dataset.team));
});

el('roomInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

el('joinBtn').addEventListener('click', () => {
  const code = el('roomInput').value.trim().toUpperCase();
  const name = el('nameInput').value.trim();

  if (!code || code.length < 4) {
    showToast('Podaj 4-znakowy kod pokoju');
    return;
  }
  if (!name) {
    showToast('Podaj swoje imię');
    return;
  }

  roomCode = code;
  playerName = name;
  startConnection();
});

/* --------------------------- połączenie ---------------------------- */

function startConnection() {
  if (socket) socket.disconnect();

  socket = connect({ role: 'player', roomCode, playerId: playerId ?? undefined });

  socket.on('connect', () => {
    if (playerId) {
      // Reconnect — serwer przywraca sesję
      showGameScreen();
    } else {
      joinGame();
    }
  });

  socket.on('state:sync', (state) => {
    lastState = state;
    if (playerId) {
      showGameScreen();
      render(state);
    }
  });

  socket.on('buzz:registered', ({ position }) => {
    hasBuzzed = true;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    el('buzzHint').textContent = `Zgłoszony (${position}.)`;
    renderBuzzButton();
  });

  socket.on('buzz:winner', ({ playerId: winnerId }) => {
    if (winnerId === playerId) {
      el('statusText').textContent = 'Twoja kolej! Odpowiadaj!';
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
    }
  });
}

function joinGame() {
  socket.emit('player:join', { name: playerName, team: selectedTeam }, (res) => {
    if (!res || !res.ok) {
      showToast(res?.error?.message ?? 'Nie udało się dołączyć');
      return;
    }
    playerId = res.playerId;
    saveSession();
    showGameScreen();
    if (res.state) render(res.state);
  });
}

/* ----------------------------- render ------------------------------ */

function showGameScreen() {
  el('joinScreen').classList.add('hidden');
  el('gameScreen').classList.remove('hidden');
  el('playerName').textContent = playerName;
  keepScreenAwake();
}

function myTeam() {
  if (!lastState) return selectedTeam;
  for (const team of ['A', 'B']) {
    if (lastState.teams[team].players.some((p) => p.id === playerId)) return team;
  }
  return selectedTeam;
}

function renderBuzzButton() {
  const btn = el('buzzBtn');
  const state = lastState;
  const canBuzz = state && state.phase === 'face_off' && !hasBuzzed;

  btn.disabled = !canBuzz;
  btn.classList.toggle('armed', Boolean(canBuzz));
  btn.classList.toggle('buzzed', hasBuzzed);

  if (hasBuzzed) {
    el('buzzHint').textContent = 'Zgłoszony';
  } else if (canBuzz) {
    el('buzzHint').textContent = 'Naciśnij!';
  } else {
    el('buzzHint').textContent = 'Czekaj…';
  }
}

function render(state) {
  const team = myTeam();
  el('playerTeam').textContent = state.teams[team].name;
  el('playerTeam').style.background =
    team === 'A' ? 'rgba(79,140,255,0.25)' : 'rgba(255,107,107,0.25)';

  el('miniTeamA').textContent = state.teams.A.name;
  el('miniScoreA').textContent = state.teams.A.score;
  el('miniTeamB').textContent = state.teams.B.name;
  el('miniScoreB').textContent = state.teams.B.score;

  const status = el('statusText');
  const info = el('playerInfo');

  switch (state.phase) {
    case 'lobby':
      status.textContent = 'Czekamy na start gry…';
      info.textContent = 'Host rozpocznie grę za chwilę';
      hasBuzzed = false;
      break;
    case 'round_intro':
      status.textContent = `Runda ${state.roundIndex + 1} z ${state.config.roundsCount}`;
      info.textContent = 'Przygotuj się!';
      hasBuzzed = false;
      break;
    case 'face_off':
      status.textContent = 'Kto pierwszy? Buzzuj!';
      info.textContent = state.currentQuestion ? state.currentQuestion.text : '';
      break;
    case 'face_off_second':
      status.textContent = 'Druga głowa rodziny odpowiada';
      info.textContent = state.currentQuestion ? state.currentQuestion.text : '';
      break;
    case 'playing':
    case 'steal': {
      const answering = state.answeringPlayerId === playerId;
      const activeTeam = state.activeTeam;
      if (answering) {
        status.textContent = 'Odpowiadasz! Mów na głos.';
      } else if (activeTeam === team) {
        status.textContent = 'Wasza drużyna odpowiada';
      } else {
        status.textContent = state.phase === 'steal' ? 'Przejęcie!' : 'Odpowiada drużyna przeciwna';
      }
      info.textContent = state.currentQuestion ? state.currentQuestion.text : '';
      break;
    }
    case 'round_summary':
      status.textContent = 'Koniec rundy';
      info.textContent = `Pula rundy: ${state.teams.A.roundPoints + state.teams.B.roundPoints} pkt`;
      hasBuzzed = false;
      break;
    case 'final_intro':
      status.textContent = 'Runda finałowa';
      info.textContent = 'Trzymamy kciuki!';
      hasBuzzed = false;
      break;
    case 'final_answers':
    case 'final_reveal':
      status.textContent = 'Finał w toku';
      info.textContent = state.finalRound
        ? `Pytanie ${Math.min(state.finalRound.currentIndex + 1, 5)} z 5`
        : '';
      break;
    case 'game_over':
      status.textContent = 'Koniec gry!';
      info.textContent = state.winner
        ? `Wygrywa ${state.teams[state.winner].name}`
        : 'Remis';
      break;
    default:
      status.textContent = '';
      info.textContent = '';
  }

  renderBuzzButton();
}

/* ------------------------------ buzz ------------------------------- */

el('buzzBtn').addEventListener('click', () => {
  if (!socket || hasBuzzed) return;
  socket.emit('player:buzz', { actionId: `buzz-${Date.now()}` }, (res) => {
    if (res && !res.ok && res.error) showToast(res.error.message);
  });
});

/* ------------------------------ start ------------------------------ */

loadSaved();

if (roomCode) {
  el('roomInput').value = roomCode;
  if (playerId && playerName) {
    el('nameInput').value = playerName;
    selectTeam(selectedTeam);
    startConnection();
  }
} else {
  selectTeam('A');
}
