// ============================================================
//  ОБЩЕЕ СОСТОЯНИЕ (G)
// ============================================================
window.G = window.G || {};
export const G = window.G;

G.me = null;
G.serverData = { players:{}, walls:[], brainrots:[], pits:[], top:[], all_nicks:[] };
G.chatShow = true;
G.chatDur = 10;
G.chatHead = true;
G.isAdmin = false;
G.invertCamX = false;
G.invertCamY = false;
G.speedLimit = null;
G.keys = { w:false, s:false, a:false, d:false, dx:0, dz:0 };
G.holdE = false;
G.holdD = false;
G.camYaw = 0;
G.camPitch = 0.28;
G.playerStates = new Map();
G.wallStates = new Map();
G.brainrotStates = new Map();

// Загрузка настроек
try {
  if (localStorage.getItem('br_invX') === 'true') G.invertCamX = true;
  if (localStorage.getItem('br_invY') === 'true') G.invertCamY = true;
  const s1 = localStorage.getItem('br_chatShow');
  const s2 = localStorage.getItem('br_chatDur');
  const s3 = localStorage.getItem('br_chatHead');
  if (s1 !== null) G.chatShow = s1 === 'true';
  if (s2 !== null) G.chatDur = parseInt(s2) || 10;
  if (s3 !== null) G.chatHead = s3 === 'true';
} catch(e){}

// ============================================================
//  УТИЛИТЫ
// ============================================================
export function fmt(n) {
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n >= 1e12) s = (n / 1e12).toFixed(2) + 'T';
  else if (n >= 1e9) s = (n / 1e9).toFixed(2) + 'B';
  else if (n >= 1e6) s = (n / 1e6).toFixed(2) + 'M';
  else if (n >= 1e3) s = (n / 1e3).toFixed(2) + 'K';
  else s = Math.floor(n).toString();
  return (neg ? '-' : '') + s;
}
window.fmt = fmt;

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
window.esc = esc;

export function showToast(text, isErr) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = text || '';
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}
window.showToast = showToast;

// ============================================================
//  SOCKET
// ============================================================
if (typeof io === 'undefined') {
  document.body.innerHTML = '<div style="padding:40px;font-size:20px;color:#fff;background:#c00">❌ socket.io не загрузился</div>';
  throw new Error('io not loaded');
}

export const socket = io({ transports: ['websocket', 'polling'] });
window.socket = socket;

socket.on('connect', () => showToast('✅ Подключено'));
socket.on('connect_error', (e) => showToast('Ошибка соединения: ' + e.message, true));

socket.on('init', d => {
  G.me = d.you;
  Object.assign(G.serverData, d);
  if (d.all_nicks) G.serverData.all_nicks = d.all_nicks;
});

socket.on('state', d => {
  G.serverData.players = d.players;
  G.serverData.walls = d.walls;
  G.serverData.brainrots = d.brainrots;
  G.serverData.pits = d.pits;
  G.serverData.top = d.top || [];
});

socket.on('auth_res', d => {
  const errEl = document.getElementById('authErr');
  if (d.ok) {
    document.getElementById('authModal').classList.remove('active');
    G.isAdmin = !!d.is_admin;
    errEl.textContent = '';
  } else {
    errEl.textContent = d.err || 'Ошибка';
  }
});

socket.on('toast', d => showToast(d.text, !!d.err));

// Чат
const chatLog = document.getElementById('chatLog');
socket.on('chat_msg', m => {
  if (!G.chatShow) return;
  const el = document.createElement('div');
  el.className = 'chat-item';
  el.innerHTML = `<span class="cn">${esc(m.nick)}</span> <span class="ci">(+${fmt(m.income)}/сек)</span>: ${esc(m.text)}`;
  chatLog.insertBefore(el, chatLog.firstChild);
  setTimeout(() => el.remove(), G.chatDur * 1000);
});

// Админка открыта через /admin
socket.on('open_admin', () => {
  document.getElementById('adminModal').classList.add('active');
  if (G.isAdmin) {
    document.getElementById('adminAuthBox').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
  } else {
    document.getElementById('adminAuthBox').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
  }
  if (typeof window.loadAllNicks === 'function') window.loadAllNicks();
});