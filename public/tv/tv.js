import { connect, getRoomCode, keepScreenAwake } from '/shared/socket-client.js';

const roomCode = getRoomCode();
const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';
const socket = connect({ role: 'tv', roomCode });

if (isDemo) {
  document.getElementById('demoBadge')?.classList.remove('hidden');
}

const el = (id) => document.getElementById(id);

const views = {
  lobby: el('viewLobby'),
  round: el('viewRound'),
  faceOff: el('viewFaceOff'),
  summary: el('viewSummary'),
  final: el('viewFinal'),
  gameOver: el('viewGameOver'),
};

let lastState = null;
let lastRevealed = new Set();

function showView(name) {
  for (const [key, node] of Object.entries(views)) {
    node.classList.toggle('hidden', key !== name);
  }
}

function renderPlayers(state) {
  const render = (teamId, listId, nameId) => {
    el(nameId).textContent = state.teams[teamId].name;
    const list = el(listId);
    list.innerHTML = '';
    for (const player of state.teams[teamId].players) {
      const li = document.createElement('li');
      if (!player.connected) li.classList.add('offline');
      li.innerHTML = `<span>${escapeHtml(player.name)}</span><span>${player.isCaptain ? '★' : ''}</span>`;
      list.appendChild(li);
    }
  };
  render('A', 'teamAPlayers', 'teamAName');
  render('B', 'teamBPlayers', 'teamBName');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderScores(state) {
  el('scoreAName').textContent = state.teams.A.name;
  el('scoreBName').textContent = state.teams.B.name;
  el('scoreA').textContent = state.teams.A.score;
  el('scoreB').textContent = state.teams.B.score;
  el('potValue').textContent = state.teams.A.roundPoints + state.teams.B.roundPoints;
}

function renderBoard(state) {
  const question = state.currentQuestion;
  if (!question) return;
  el('questionText').textContent = question.text;

  const board = el('answerBoard');
  board.innerHTML = '';
  for (const answer of question.answers) {
    const slot = document.createElement('div');
    slot.className = 'answer-slot';
    if (answer.revealed) {
      slot.classList.add('revealed');
      slot.innerHTML = `
        <span class="rank">${answer.rank}</span>
        <span class="text">${escapeHtml(answer.text)}</span>
        <span class="points">${answer.points}</span>`;
    } else {
      slot.classList.add('hidden-answer');
      slot.innerHTML = `
        <span class="rank">${answer.rank}</span>
        <span class="text">??????????</span>
        <span class="points">${answer.points}</span>`;
    }
    board.appendChild(slot);
  }

  // Strike'i — czerwone X pojawiają się kolejno
  const strikes = el('strikes');
  strikes.innerHTML = '';
  for (let i = 0; i < state.config.maxStrikes; i += 1) {
    const mark = document.createElement('span');
    mark.className = 'strike-mark';
    if (i < state.strikes) {
      mark.classList.add('active');
      mark.textContent = '✕';
    }
    strikes.appendChild(mark);
  }
}

function renderFaceOff(state) {
  const question = state.currentQuestion;
  el('faceOffQuestion').textContent = question ? question.text : 'Pytanie';
  const list = el('buzzList');
  list.innerHTML = '';

  const findPlayer = (id) =>
    [...state.teams.A.players, ...state.teams.B.players].find((p) => p.id === id);

  // Głowy rodzin
  const headA = findPlayer(state.familyHeads.A);
  const headB = findPlayer(state.familyHeads.B);

  const title = el('faceOffTitle');
  if (title) {
    title.textContent =
      state.phase === 'face_off_second'
        ? 'Druga głowa rodziny odpowiada!'
        : 'Głowy rodzin — kto pierwszy?';
  }

  const heads = [
    { team: 'A', player: headA },
    { team: 'B', player: headB },
  ];
  for (const { team, player } of heads) {
    const row = document.createElement('div');
    row.className = `head-card team-${team.toLowerCase()}`;
    row.innerHTML = `
      <span class="head-name">${escapeHtml(player ? player.name : '—')}</span>
      <span class="head-team">${escapeHtml(state.teams[team].name)}</span>`;
    list.appendChild(row);
  }

  // Wynik pierwszej odpowiedzi w face-off
  if (state.faceOffFirstAnswer) {
    const first = state.faceOffFirstAnswer;
    const info = document.createElement('div');
    info.className = 'faceoff-result';
    info.textContent = first.answerId
      ? `${state.teams[first.team].name} trafiła (pozycja ${first.rank})`
      : `${state.teams[first.team].name} się pomyliła`;
    list.appendChild(info);
  }
}

function renderSummary(state) {
  const team = state.activeTeam;
  const points = team ? state.teams[team].roundPoints : 0;
  el('summaryTitle').textContent = 'Koniec rundy';
  el('summaryPoints').textContent = points;
  el('summaryTeam').textContent = team ? state.teams[team].name : '';
}

function renderFinal(state) {
  const final = state.finalRound;
  if (!final) return;
  const activePlayer = final.players[final.activePlayerIndex];
  el('finalTitle').textContent = `Runda finałowa — ${state.teams[final.team].name} · ${
    activePlayer ? activePlayer.name : ''
  } (${final.activePlayerIndex + 1}/2)`;

  const list = el('finalList');
  list.innerHTML = '';
  final.questions.forEach((question, index) => {
    const item = document.createElement('div');
    item.className = 'final-item';
    const revealed = question.answers.filter((a) => a.revealed);
    const answerText = revealed.length
      ? revealed.map((a) => `${escapeHtml(a.text)} (${a.points})`).join(', ')
      : '—';
    item.innerHTML = `
      <span class="q">${index + 1}. ${escapeHtml(question.text)}</span>
      <span class="a ${revealed.length ? '' : 'pending'}">${answerText}</span>`;
    list.appendChild(item);
  });

  const p1 = final.players[0];
  const p2 = final.players[1];
  el('finalTotal').innerHTML = `
    <div>${escapeHtml(p1.name)}: <strong>${p1.totalPoints}</strong></div>
    <div>${escapeHtml(p2.name)}: <strong>${p2.totalPoints}</strong></div>
    <div class="final-sum">Suma: <strong>${final.totalPoints}</strong> / ${final.targetPoints}</div>`;
}

function renderGameOver(state) {
  const winner = state.winner;
  el('winnerText').textContent = winner
    ? `Wygrywa ${state.teams[winner].name}!`
    : 'Remis!';
  el('finalScores').innerHTML = `
    <div>${escapeHtml(state.teams.A.name)}: <strong>${state.teams.A.score}</strong></div>
    <div>${escapeHtml(state.teams.B.name)}: <strong>${state.teams.B.score}</strong></div>`;
}

function render(state) {
  lastState = state;
  renderScores(state);
  renderPlayers(state);

  const roundLabel = el('roundLabel');
  const roundInfo = `Runda ${state.roundIndex + 1} / ${state.config.roundsCount}`;
  const multiplier = state.pointMultiplier > 1 ? ` · ×${state.pointMultiplier}` : '';

  if (state.phase === 'lobby') {
    roundLabel.textContent = 'Lobby';
    showView('lobby');
  } else if (state.phase === 'round_intro') {
    roundLabel.textContent = roundInfo + multiplier;
    showView('summary');
    el('summaryTitle').textContent = `Runda ${state.roundIndex + 1}`;
    el('summaryPoints').textContent = '—';
    el('summaryTeam').textContent = 'Przygotujcie się!';
  } else if (state.phase === 'face_off' || state.phase === 'face_off_second') {
    roundLabel.textContent = roundInfo + multiplier;
    showView('faceOff');
    renderFaceOff(state);
  } else if (state.phase === 'playing' || state.phase === 'steal') {
    roundLabel.textContent =
      state.phase === 'steal' ? 'PRZEJĘCIE!' : roundInfo + multiplier;
    showView('round');
    renderBoard(state);
  } else if (state.phase === 'round_summary') {
    roundLabel.textContent = 'Koniec rundy';
    showView('summary');
    renderSummary(state);
  } else if (state.phase === 'final_intro') {
    roundLabel.textContent = 'Finał';
    showView('summary');
    el('summaryPoints').textContent = '★';
    el('summaryTeam').textContent = state.winner
      ? `Do finału przechodzi ${state.teams[state.winner].name}`
      : 'Runda finałowa';
  } else if (state.phase === 'final_answers' || state.phase === 'final_reveal') {
    roundLabel.textContent = 'Finał';
    showView('final');
    renderFinal(state);
  } else if (state.phase === 'game_over') {
    roundLabel.textContent = 'Koniec gry';
    showView('gameOver');
    renderGameOver(state);
  }
}

socket.on('state:sync', (state) => {
  // Animacja tylko dla nowo odkrytych odpowiedzi
  if (lastState?.currentQuestion && state.currentQuestion) {
    const prev = new Set(
      lastState.currentQuestion.answers.filter((a) => a.revealed).map((a) => a.answerId)
    );
    lastRevealed = new Set(
      state.currentQuestion.answers.filter((a) => a.revealed && !prev.has(a.answerId)).map((a) => a.answerId)
    );
  }
  render(state);
});

socket.on('buzz:winner', ({ playerId }) => {
  if (!lastState) return;
  const player = [...lastState.teams.A.players, ...lastState.teams.B.players].find(
    (p) => p.id === playerId
  );
  if (player) {
    const banner = document.createElement('div');
    banner.className = 'toast';
    banner.style.background = 'var(--accent)';
    banner.style.color = '#1a1400';
    banner.textContent = `${player.name} — pierwszy!`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 2500);
  }
});

// QR w lobby
async function loadQr() {
  if (!roomCode) return;
  el('roomCode').textContent = roomCode;

  if (isDemo) {
    // W trybie demo nie ma graczy do dołączenia — pokazujemy informację
    el('qrImage').style.display = 'none';
    el('joinUrl').textContent = 'TRYB DEMO — boty grają automatycznie';
    el('joinUrl').style.color = 'var(--gold)';
    el('joinUrl').style.fontWeight = '800';
    el('joinUrl').style.fontSize = '2vmin';
    const heading = document.querySelector('.lobby-qr h2');
    if (heading) heading.textContent = 'Pokaz gry';
    const hint = document.querySelector('.lobby-hint');
    if (hint) hint.textContent = 'Symulacja rozgrywki — bez udziału graczy';
    return;
  }

  el('qrImage').src = `/api/qr?room=${encodeURIComponent(roomCode)}`;
  try {
    const info = await fetch('/api/server-info').then((r) => r.json());
    el('joinUrl').textContent = `${info.baseUrl}/join?room=${roomCode}`;
  } catch {
    el('joinUrl').textContent = `${window.location.origin}/join?room=${roomCode}`;
  }
}

loadQr();
keepScreenAwake();
document.addEventListener('click', () => {
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});
