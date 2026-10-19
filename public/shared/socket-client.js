/* Wspólny klient Socket.IO dla TV, telefonu i panelu hosta. */

export function getRoomCode() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('room') || '').toUpperCase();
}

export function showToast(message, timeout = 3000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

export function setConnectionBadge(online) {
  let badge = document.querySelector('.connection-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'connection-badge';
    document.body.appendChild(badge);
  }
  badge.textContent = online ? 'ONLINE' : 'OFFLINE';
  badge.classList.toggle('online', online);
}

/**
 * Tworzy połączenie Socket.IO z automatycznym reconnectem.
 * @param {{role: string, roomCode: string, playerId?: string, hostPin?: string}} auth
 */
export function connect(auth) {
  const socket = io({
    auth,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => setConnectionBadge(true));
  socket.on('disconnect', () => setConnectionBadge(false));
  socket.on('connect_error', (err) => {
    setConnectionBadge(false);
    showToast(`Błąd połączenia: ${err.message}`);
  });
  socket.on('game:error', (error) => showToast(error.message));

  return socket;
}

/** Wywołuje akcję hosta z unikalnym actionId (idempotencja). */
export function hostAction(socket, event, payload = {}) {
  const actionId = `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    socket.emit(event, { ...payload, actionId }, (res) => {
      if (res && !res.ok && res.error) showToast(res.error.message);
      resolve(res);
    });
  });
}

/** Blokada usypiania ekranu (TV i telefony). */
export async function keepScreenAwake() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch {
    /* Wake Lock niedostępny — ignorujemy */
  }
}
