import { connect, getRoomCode, hostAction, showToast } from '/shared/socket-client.js';

const el = (id) => document.getElementById(id);

const PIN_KEY = 'familiada.hostPin';
const ROOM_KEY = 'familiada.hostRoom';
const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

let hostPin = localStorage.getItem(PIN_KEY) || '';
let roomCode = getRoomCode() || localStorage.getItem(ROOM_KEY) || '';
let socket = null;
let state = null;
let questions = [];
let editingQuestionId = null;
let pendingMatches = [];

/* ------------------------------ LOGIN ------------------------------ */

el('loginBtn').addEventListener('click', () => {
  const pin = el('pinInput').value.trim();
  if (!pin) {
    showToast('Podaj PIN');
    return;
  }
  hostPin = pin;
  localStorage.setItem(PIN_KEY, pin);
  startHost();
});

el('pinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('loginBtn').click();
});

async function startHost() {
  if (!roomCode) {
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const data = await res.json();
      roomCode = data.roomCode;
      localStorage.setItem(ROOM_KEY, roomCode);
    } catch {
      showToast('Nie udało się utworzyć pokoju');
      return;
    }
  }

  socket = connect({ role: 'host', roomCode, hostPin });

  socket.on('connect', () => {
    el('loginScreen').classList.add('hidden');
    el('panelScreen').classList.remove('hidden');
    el('roomCodeLabel').textContent = roomCode;
    if (isDemo) el('hostDemoBadge').classList.remove('hidden');
    loadQuestions();
    loadHistory();
  });

  socket.on('connect_error', (err) => {
    if (err.message.includes('PIN')) {
      localStorage.removeItem(PIN_KEY);
      showToast('Nieprawidłowy PIN hosta');
    }
  });

  socket.on('state:sync', (s) => {
    state = s;
    renderControl();
    updateAnswerTimer();
  });

  socket.on('answer:suggestions', ({ matches }) => {
    pendingMatches = matches;
    renderSuggestions();
  });
}

/* --------------------------- STEROWANIE ---------------------------- */

function phaseName(phase) {
  const names = {
    lobby: 'Lobby',
    round_intro: 'Przygotowanie rundy',
    face_off: 'Pojedynek (buzz)',
    playing: 'Odpowiada drużyna',
    steal: 'Przejęcie',
    round_summary: 'Koniec rundy',
    final_intro: 'Przed finałem',
    final_answers: 'Finał — odpowiedzi',
    final_reveal: 'Finał — odkrywanie',
    game_over: 'Koniec gry',
  };
  return names[phase] ?? phase;
}

function renderControl() {
  if (!state) return;

  el('phaseLabel').textContent = phaseName(state.phase);
  el('phaseRound').textContent =
    state.phase === 'lobby' ? '' : `Runda ${state.roundIndex + 1} / ${state.config.roundsCount}`;

  el('hostTeamA').textContent = state.teams.A.name;
  el('hostTeamB').textContent = state.teams.B.name;
  el('hostScoreA').textContent = state.teams.A.score;
  el('hostScoreB').textContent = state.teams.B.score;
  el('hostPot').textContent = state.teams.A.roundPoints + state.teams.B.roundPoints;

  el('cfgTeamA').value = state.config.teamAName;
  el('cfgTeamB').value = state.config.teamBName;
  el('cfgGameTarget').value = state.config.gameTargetPoints;
  el('cfgTarget').value = state.config.finalTargetPoints;
  el('cfgTimeLimit').value = state.config.answerTimeLimitSeconds;

  renderQuestion();
  renderBuzzQueue();
  renderPlayers();
  renderActions();
}

function renderQuestion() {
  const question = state.currentQuestion;
  const box = el('hostQuestion');
  const list = el('hostAnswers');
  list.innerHTML = '';

  if (state.phase === 'final_answers' || state.phase === 'final_reveal') {
    const final = state.finalRound;
    if (!final) return;
    const player = final.players[final.activePlayerIndex];
    const current = final.questions[final.currentIndex];
    box.textContent = current
      ? `Finał — ${player.name} (${final.currentIndex + 1}/5): ${current.text}`
      : `Finał — ${player.name}: wszystkie pytania wypełnione`;
    final.questions.forEach((q, index) => {
      const row = document.createElement('div');
      row.className = 'host-answer';
      const given = player.answers.find((a) => a.questionIndex === index);
      row.innerHTML = `<span class="rank">${index + 1}.</span>
        <span class="text">${escapeHtml(q.text)}</span>
        <span class="points">${given && given.text ? escapeHtml(given.text) : '—'}</span>`;
      list.appendChild(row);
    });
    return;
  }

  if (!question) {
    box.textContent = 'Brak aktywnego pytania';
    return;
  }

  box.textContent = question.text;
  for (const answer of question.answers) {
    const row = document.createElement('div');
    row.className = `host-answer${answer.revealed ? ' revealed' : ''}`;
    row.innerHTML = `
      <span class="rank">${answer.rank}.</span>
      <span class="text">${escapeHtml(answer.text)}</span>
      <span class="points">${answer.points}</span>`;

    if (!answer.revealed) {
      if (state.phase === 'playing' || state.phase === 'steal') {
        const btn = document.createElement('button');
        btn.className = 'reveal-btn';
        btn.textContent = 'Odkryj';
        btn.addEventListener('click', () => confirmAnswer(answer.answerId));
        row.appendChild(btn);
      } else if (state.phase === 'face_off' && pendingFaceOffTeam) {
        const btn = document.createElement('button');
        btn.className = 'reveal-btn';
        btn.textContent = `Trafienie ${pendingFaceOffTeam}`;
        btn.addEventListener('click', () => {
          hostAction(socket, 'host:faceOffAnswer', {
            team: pendingFaceOffTeam,
            answerId: answer.answerId,
          });
          pendingFaceOffTeam = null;
        });
        row.appendChild(btn);
      } else if (state.phase === 'face_off_second') {
        const btn = document.createElement('button');
        btn.className = 'reveal-btn';
        btn.textContent = 'Trafienie';
        btn.addEventListener('click', () => faceOffSecondAnswer(answer.answerId));
        row.appendChild(btn);
      }
    }
    list.appendChild(row);
  }
}

function renderBuzzQueue() {
  const container = el('buzzQueue');
  container.innerHTML = '';
  if (!state.buzzQueue.length) {
    container.innerHTML = '<p class="muted">Brak zgłoszeń</p>';
    return;
  }
  state.buzzQueue.forEach((entry, index) => {
    const player = findPlayer(entry.playerId);
    const row = document.createElement('div');
    row.className = `buzz-item${index === 0 ? ' first' : ''}`;
    row.innerHTML = `<span>${escapeHtml(player ? player.name : 'Gracz')} <span class="muted">(${
      state.teams[entry.team].name
    })</span></span>`;
    if (state.phase === 'face_off') {
      const btn = document.createElement('button');
      btn.className = 'pick';
      btn.textContent = 'Wybierz';
      btn.addEventListener('click', () => selectAnswerer(entry.playerId));
      row.appendChild(btn);
    }
    container.appendChild(row);
  });
}

function renderPlayers() {
  const container = el('playersList');
  container.innerHTML = '';
  for (const team of ['A', 'B']) {
    for (const player of state.teams[team].players) {
      const row = document.createElement('div');
      row.className = `player-row${player.connected ? '' : ' offline'}`;
      row.innerHTML = `<span>${escapeHtml(player.name)}</span>
        <span class="team-tag">${state.teams[team].name}</span>`;
      container.appendChild(row);
    }
  }
  if (!container.children.length) {
    container.innerHTML = '<p class="muted">Brak graczy</p>';
  }
}

function renderActions() {
  const container = el('actions');
  container.innerHTML = '';
  const add = (label, cls, handler) => {
    const btn = document.createElement('button');
    btn.className = `btn ${cls}`;
    btn.textContent = label;
    btn.addEventListener('click', handler);
    container.appendChild(btn);
  };

  switch (state.phase) {
    case 'lobby':
      add('Rozpocznij grę', 'btn-primary', () => hostAction(socket, 'host:startGame'));
      break;
    case 'round_intro':
      add('Pokaż pytanie', 'btn-primary', () => hostAction(socket, 'host:showQuestion'));
      break;
    case 'face_off':
      add('Głowa A — trafienie', 'btn-ok', () => faceOffAnswer('A'));
      add('Głowa A — błąd', 'btn-danger', () => faceOffAnswer('A', null));
      add('Głowa B — trafienie', 'btn-ok', () => faceOffAnswer('B'));
      add('Głowa B — błąd', 'btn-danger', () => faceOffAnswer('B', null));
      break;
    case 'face_off_second':
      add('Druga głowa — trafienie', 'btn-ok', () => faceOffSecondAnswer());
      add('Druga głowa — błąd', 'btn-danger', () => faceOffSecondAnswer(null));
      break;
    case 'playing':
      add('Błąd (strike)', 'btn-danger', () => hostAction(socket, 'host:rejectAnswer'));
      if (state.canPassQuestion) {
        add('Oddaj pytanie przeciwnikom', '', () => hostAction(socket, 'host:passQuestion'));
      }
      break;
    case 'steal':
      add('Błąd (strike)', 'btn-danger', () => hostAction(socket, 'host:rejectAnswer'));
      break;
    case 'round_summary':
      add('Następna runda', 'btn-primary', () => hostAction(socket, 'host:nextRound'));
      break;
    case 'final_intro':
      add('Start finału — drużyna A', 'btn-primary', () => startFinal('A'));
      add('Start finału — drużyna B', 'btn-primary', () => startFinal('B'));
      break;
    case 'final_answers':
      add('Pomiń pytanie', '', () => hostAction(socket, 'host:skipFinalQuestion'));
      add('Zakończ turę gracza', 'btn-primary', () =>
        hostAction(socket, 'host:finishFinalPlayer')
      );
      add('Odkryj finał', 'btn-ok', () => revealFinal());
      break;
    case 'final_reveal':
      add('Zakończ grę', 'btn-primary', () => hostAction(socket, 'host:endGame'));
      break;
    case 'game_over':
      add('Nowa gra (reset)', 'btn-primary', () => hostAction(socket, 'host:resetGame'));
      break;
    default:
      break;
  }
}

/** Face-off: host wybiera odpowiedź z listy (lub błąd). */
function faceOffAnswer(team, answerId) {
  if (answerId === undefined) {
    // Wybór trafienia — host klika odpowiedź na liście
    showToast('Kliknij odpowiedź na liście, aby zatwierdzić trafienie');
    pendingFaceOffTeam = team;
    return;
  }
  hostAction(socket, 'host:faceOffAnswer', { team, answerId });
}

let pendingFaceOffTeam = null;

function faceOffSecondAnswer(answerId) {
  const team = state.faceOffFirstAnswer
    ? state.faceOffFirstAnswer.team === 'A'
      ? 'B'
      : 'A'
    : 'B';
  hostAction(socket, 'host:faceOffSecondAnswer', { team, answerId });
}

function startFinal(team) {
  const players = state.teams[team].players;
  const first = players[0];
  const second = players[1] ?? players[0];
  if (!first || !second) {
    showToast('Drużyna musi mieć co najmniej 2 graczy');
    return;
  }
  hostAction(socket, 'host:startFinal', {
    team,
    firstPlayer: { id: first.id, name: first.name },
    secondPlayer: { id: second.id, name: second.name },
  });
}

function findPlayer(playerId) {
  if (!state) return null;
  return [...state.teams.A.players, ...state.teams.B.players].find((p) => p.id === playerId);
}

/* --------------------------- AKCJE GRY ----------------------------- */

function selectAnswerer(playerId) {
  hostAction(socket, 'host:selectAnswerer', { playerId });
}

function confirmAnswer(answerId) {
  hostAction(socket, 'host:confirmAnswer', { answerId });
  clearSuggestions();
}

function submitAnswer() {
  const input = el('answerInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('host:submitAnswer', { actionId: `submit-${Date.now()}`, text }, (res) => {
    if (res && res.ok) {
      pendingMatches = res.matches ?? [];
      renderSuggestions();
    } else if (res?.error) {
      showToast(res.error.message);
    }
  });
}

function renderSuggestions() {
  const container = el('suggestions');
  container.innerHTML = '';
  if (!pendingMatches.length) {
    container.innerHTML = '<p class="muted">Brak dopasowań — możesz odrzucić odpowiedź</p>';
    return;
  }
  for (const match of pendingMatches) {
    const row = document.createElement('div');
    row.className = 'suggestion';
    row.innerHTML = `
      <span class="score">${Math.round(match.score * 100)}%</span>
      <span class="text">${escapeHtml(match.text)}</span>
      <span class="points">${match.points} pkt</span>`;
    const btn = document.createElement('button');
    btn.className = 'accept';
    btn.textContent = 'Zatwierdź';
    btn.addEventListener('click', () => confirmAnswer(match.answerId));
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function clearSuggestions() {
  pendingMatches = [];
  el('suggestions').innerHTML = '';
  el('answerInput').value = '';
}

/* --------------------------- TIMER 3s ------------------------------ */

let timerInterval = null;

function updateAnswerTimer() {
  const timerEl = el('answerTimer');
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (!state) {
    timerEl.classList.add('hidden');
    return;
  }

  // Timer tylko w fazach, w których gracz odpowiada
  const isAnswering =
    state.phase === 'playing' ||
    state.phase === 'steal' ||
    state.phase === 'face_off' ||
    state.phase === 'face_off_second';

  if (!isAnswering) {
    timerEl.classList.add('hidden');
    return;
  }

  const limit = state.config.answerTimeLimitSeconds ?? 3;
  let remaining = limit;
  timerEl.classList.remove('hidden');
  timerEl.textContent = String(remaining);
  timerEl.classList.remove('urgent');

  timerInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      timerEl.textContent = '0';
      timerEl.classList.add('urgent');
      clearInterval(timerInterval);
      timerInterval = null;
      return;
    }
    timerEl.textContent = String(remaining);
    timerEl.classList.toggle('urgent', remaining <= 1);
  }, 1000);
}

function revealFinal() {
  const final = state.finalRound;
  if (!final) return;

  // Dla każdego gracza i pytania dopasowujemy wpisany tekst do odpowiedzi.
  const normalize = (s) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .trim();

  const matches = final.players.map((player) =>
    final.questions.map((question, qIndex) => {
      const entry = player.answers.find((a) => a.questionIndex === qIndex);
      if (!entry || !entry.text) return null;
      const target = normalize(entry.text);
      const found = question.answers.find((a) => normalize(a.text) === target);
      return found ? found.answerId : null;
    })
  );

  hostAction(socket, 'host:revealFinal', { matches });
}

el('submitAnswerBtn').addEventListener('click', submitAnswer);
el('answerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer();
  if (e.key === 'Escape') clearSuggestions();
});

el('saveConfigBtn').addEventListener('click', () => {
  hostAction(socket, 'host:updateConfig', {
    config: {
      teamAName: el('cfgTeamA').value.trim() || 'Drużyna A',
      teamBName: el('cfgTeamB').value.trim() || 'Drużyna B',
      gameTargetPoints: Number(el('cfgGameTarget').value) || 300,
      finalTargetPoints: Number(el('cfgTarget').value) || 200,
      answerTimeLimitSeconds: Number(el('cfgTimeLimit').value) || 3,
    },
  });
});

el('copyLinkBtn').addEventListener('click', async () => {
  const url = `${window.location.origin}/tv?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link TV skopiowany');
  } catch {
    showToast(url);
  }
});

/* ----------------------------- PYTANIA ----------------------------- */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Host-Pin': hostPin,
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Błąd API');
  return data;
}

async function loadQuestions() {
  try {
    const data = await api('/questions?includeInactive=true');
    questions = data.questions;
    renderQuestionsList();
    el('questionsCount').textContent = `${questions.length} pytań`;
  } catch (error) {
    showToast(error.message);
  }
}

function renderQuestionsList() {
  const list = el('questionsList');
  list.innerHTML = '';
  for (const q of questions) {
    const item = document.createElement('div');
    item.className = `question-item${q.id === editingQuestionId ? ' active' : ''}`;
    item.innerHTML = `
      <div>${escapeHtml(q.text)}</div>
      <div class="meta">${q.roundType === 'final' ? 'FINAŁ' : 'RUNDA'} · ${
        q.answers.length
      } odp. · ${q.isActive ? 'aktywne' : 'nieaktywne'}</div>`;
    item.addEventListener('click', () => openEditor(q));
    list.appendChild(item);
  }
}

function openEditor(question) {
  editingQuestionId = question ? question.id : null;
  renderQuestionsList();

  const editor = el('questionEditor');
  const q = question ?? {
    text: '',
    category: '',
    roundType: 'normal',
    difficulty: 1,
    isActive: true,
    answers: [{ text: '', points: 10, rank: 1, aliases: [] }],
  };

  editor.innerHTML = `
    <label class="field-label">Treść pytania</label>
    <input id="editText" type="text" value="${escapeAttr(q.text)}" />
    <div class="editor-row">
      <div>
        <label class="field-label">Kategoria</label>
        <input id="editCategory" type="text" value="${escapeAttr(q.category ?? '')}" />
      </div>
      <div>
        <label class="field-label">Typ</label>
        <select id="editRoundType">
          <option value="normal"${q.roundType === 'normal' ? ' selected' : ''}>Runda normalna</option>
          <option value="final"${q.roundType === 'final' ? ' selected' : ''}>Finał</option>
        </select>
      </div>
    </div>
    <label class="field-label">Odpowiedzi (rank · treść · punkty · aliasy)</label>
    <div class="answers-editor" id="answersEditor"></div>
    <button id="addAnswerBtn" class="btn btn-small">+ Dodaj odpowiedź</button>
    <div class="editor-actions">
      <button id="saveQuestionBtn" class="btn btn-primary">Zapisz</button>
      ${question ? '<button id="deleteQuestionBtn" class="btn btn-danger">Dezaktywuj</button>' : ''}
    </div>`;

  renderAnswersEditor(q.answers);

  el('addAnswerBtn').addEventListener('click', () => {
    const rows = el('answersEditor').children.length;
    addAnswerRow({ text: '', points: 10, rank: rows + 1, aliases: [] });
  });
  el('saveQuestionBtn').addEventListener('click', saveQuestion);
  if (question) {
    el('deleteQuestionBtn').addEventListener('click', () => deactivateQuestion(question.id));
  }
}

function renderAnswersEditor(answers) {
  const container = el('answersEditor');
  container.innerHTML = '';
  answers.forEach((a) => addAnswerRow(a));
}

function addAnswerRow(answer) {
  const container = el('answersEditor');
  const row = document.createElement('div');
  row.className = 'answer-edit-row';
  row.innerHTML = `
    <input class="rank" type="number" min="1" value="${answer.rank}" />
    <input class="text" type="text" placeholder="Odpowiedź" value="${escapeAttr(answer.text)}" />
    <input class="points" type="number" min="1" value="${answer.points}" />
    <input class="aliases" type="text" placeholder="aliasy, po przecinku" value="${escapeAttr(
      (answer.aliases ?? []).join(', ')
    )}" />
    <button class="remove" type="button">✕</button>`;
  row.querySelector('.remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectAnswers() {
  return [...el('answersEditor').children].map((row) => ({
    rank: Number(row.querySelector('.rank').value),
    text: row.querySelector('.text').value.trim(),
    points: Number(row.querySelector('.points').value),
    aliases: row
      .querySelector('.aliases')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}

async function saveQuestion() {
  const payload = {
    text: el('editText').value.trim(),
    category: el('editCategory').value.trim() || null,
    roundType: el('editRoundType').value,
    answers: collectAnswers(),
  };
  try {
    if (editingQuestionId) {
      await api(`/questions/${editingQuestionId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/questions', { method: 'POST', body: JSON.stringify(payload) });
    }
    showToast('Pytanie zapisane');
    editingQuestionId = null;
    await loadQuestions();
    el('questionEditor').innerHTML = '<p class="muted">Wybierz pytanie z listy lub utwórz nowe</p>';
  } catch (error) {
    showToast(error.message);
  }
}

async function deactivateQuestion(id) {
  try {
    await api(`/questions/${id}`, { method: 'DELETE' });
    showToast('Pytanie dezaktywowane');
    editingQuestionId = null;
    await loadQuestions();
    el('questionEditor').innerHTML = '<p class="muted">Wybierz pytanie z listy lub utwórz nowe</p>';
  } catch (error) {
    showToast(error.message);
  }
}

el('newQuestionBtn').addEventListener('click', () => openEditor(null));

el('exportBtn').addEventListener('click', async () => {
  try {
    const data = await api('/questions/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message);
  }
});

el('importBtn').addEventListener('click', () => el('importFile').click());

el('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const result = await api('/questions/import', {
      method: 'POST',
      body: JSON.stringify(json),
    });
    showToast(`Zaimportowano ${result.imported} pytań`);
    await loadQuestions();
  } catch (error) {
    showToast(error.message);
  } finally {
    e.target.value = '';
  }
});

/* ----------------------------- HISTORIA ---------------------------- */

async function loadHistory() {
  try {
    const data = await api('/games');
    const list = el('historyList');
    list.innerHTML = '';
    if (!data.games.length) {
      list.innerHTML = '<p class="muted">Brak rozegranych gier</p>';
      return;
    }
    for (const game of data.games) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div>
          <div>${escapeHtml(game.teamAName)} vs ${escapeHtml(game.teamBName)}</div>
          <div class="date">${new Date(game.startedAt).toLocaleString('pl-PL')} · pokój ${
            game.roomCode
          }</div>
        </div>
        <div class="result">${game.teamAScore} : ${game.teamBScore}</div>
        <div class="muted">${game.finishedAt ? 'zakończona' : 'w toku'}</div>`;
      list.appendChild(item);
    }
  } catch (error) {
    showToast(error.message);
  }
}

/* ------------------------------ TABS ------------------------------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    el('tabControl').classList.toggle('hidden', target !== 'control');
    el('tabQuestions').classList.toggle('hidden', target !== 'questions');
    el('tabHistory').classList.toggle('hidden', target !== 'history');
    if (target === 'history') loadHistory();
  });
});

/* ---------------------------- POMOCNICZE --------------------------- */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

/* ------------------------------ START ------------------------------ */

if (hostPin) {
  el('pinInput').value = hostPin;
  startHost();
}
