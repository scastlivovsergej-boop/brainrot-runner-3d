import * as THREE from 'three';

// ============================================================
//  УТИЛИТЫ
// ============================================================
function fmt(n) {
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n >= 1e12) s = (n / 1e12).toFixed(2) + 'T';
  else if (n >= 1e9) s = (n / 1e9).toFixed(2) + 'B';
  else if (n >= 1e6) s = (n / 1e6).toFixed(2) + 'M';
  else if (n >= 1e3) s = (n / 1e3).toFixed(2) + 'K';
  else s = Math.floor(n).toString();
  return (neg ? '-' : '') + s;
}

const LANE_HALF = 15, PIT_DEPTH = 4.0;
const SAFE_X_MIN = -100, SAFE_X_MAX = 150, SAFE_Z_HALF = 80;
const ROAD_START_X = SAFE_X_MAX;
const BASE_ZONE_X = 32;
const SHOP_X = 100, SHOP_Z = 0;
const PAD_COLS = 6, PAD_XS = [5,10,15,20,25,30], PAD_Z_START = -14, PAD_Z_STEP = 3.5;
const MAX_PADS = 50;

function padPos(i) {
  const c = i % PAD_COLS, r = Math.floor(i / PAD_COLS);
  return { x: PAD_XS[c], z: PAD_Z_START + r * PAD_Z_STEP };
}

// ============================================================
//  МОБИЛЬНОЕ ОПРЕДЕЛЕНИЕ
// ============================================================
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ============================================================
//  ПРОВЕРКА SOCKET.IO
// ============================================================
if (typeof io === 'undefined') {
  document.body.innerHTML = '<div style="padding:40px;font-size:20px;color:#fff;background:#c00">❌ socket.io не загрузился</div>';
  throw new Error('io not loaded');
}

// ============================================================
//  СОКЕТ
// ============================================================
const socket = io({ transports: ['websocket', 'polling'] });
window.socket = socket;

let me = null;
let serverData = { players:{}, walls:[], brainrots:[], pits:[], top:[] };
let chatShow = true, chatDur = 10, chatHead = true, isAdmin = false;
try {
  const s1 = localStorage.getItem('br_chatShow');
  const s2 = localStorage.getItem('br_chatDur');
  const s3 = localStorage.getItem('br_chatHead');
  if (s1 !== null) chatShow = s1 === 'true';
  if (s2 !== null) chatDur = parseInt(s2) || 10;
  if (s3 !== null) chatHead = s3 === 'true';
} catch(e){}

// ============================================================
//  ТОСТЫ
// ============================================================
function showToast(text, isErr) {
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
//  СОКЕТ-ОБРАБОТЧИКИ
// ============================================================
socket.on('connect', () => showToast('✅ Подключено'));
socket.on('connect_error', (e) => showToast('Ошибка соединения: ' + e.message, true));

socket.on('init', d => { me = d.you; Object.assign(serverData, d); });
socket.on('state', d => {
  serverData.players = d.players;
  serverData.walls = d.walls;
  serverData.brainrots = d.brainrots;
  serverData.pits = d.pits;
  serverData.top = d.top || [];
});

socket.on('player:hit', d => {
  if (d.id !== me) return;
  const f = document.getElementById('flash'), m = document.getElementById('hitMsg');
  f.style.background = 'rgba(231,76,60,0.55)';
  m.classList.add('show');
  setTimeout(() => f.style.background = 'rgba(231,76,60,0)', 140);
  setTimeout(() => m.classList.remove('show'), 800);
  const st = playerStates.get(me);
  if (st) { st.current.set(ROAD_START_X - 15, 0, 0); st.target.set(ROAD_START_X - 15, 0, 0); }
});

socket.on('auth_res', d => {
  const errEl = document.getElementById('authErr');
  if (d.ok) {
    document.getElementById('authModal').classList.remove('active');
    isAdmin = !!d.is_admin;
    errEl.textContent = '';
  } else {
    errEl.textContent = d.err || 'Ошибка';
  }
});

socket.on('open_admin', () => {
  document.getElementById('adminModal').classList.add('active');
  if (isAdmin) {
    document.getElementById('adminAuthBox').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
  } else {
    document.getElementById('adminAuthBox').style.display = 'block';
    document.getElementById('adminPanel').style.display = 'none';
  }
});

socket.on('toast', d => showToast(d.text, !!d.err));

const chatLog = document.getElementById('chatLog');
socket.on('chat_msg', m => {
  if (!chatShow) return;
  const el = document.createElement('div');
  el.className = 'chat-item';
  el.innerHTML = `<span class="cn">${esc(m.nick)}</span> <span class="ci">(+${fmt(m.income)}/сек)</span>: ${esc(m.text)}`;
  chatLog.insertBefore(el, chatLog.firstChild);
  setTimeout(() => el.remove(), chatDur * 1000);
});
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ============================================================
//  ФУНКЦИИ
// ============================================================
window.upgradeBase = function() {
  socket.emit('upgrade_base', {}, (resp) => {});
};

function buySpeed(kind) {
  socket.emit('buy_speed', { kind }, (resp) => {});
}

window.admCmd = function(cmd) {
  const nick = document.getElementById('admNick').value.trim() || (serverData.players[me] && serverData.players[me].name) || '';
  const payload = { cmd, nick };
  if (cmd === 'money') payload.value = parseFloat(document.getElementById('admMoney').value) || 0;
  else if (cmd === 'income_bonus') payload.value = parseFloat(document.getElementById('admInc').value) || 0;
  else if (cmd === 'speed') payload.value = parseInt(document.getElementById('admSpeed').value) || 0;
  else if (cmd === 'slots') payload.value = parseInt(document.getElementById('admSlots').value) || 10;
  else if (cmd === 'set_password') payload.value = document.getElementById('admPass').value.trim();
  else if (cmd === 'reset_player') {
    if (!confirm('Точно СБРОСИТЬ ВСЕ данные игрока?\n\nДеньги, скорость, верити, цены, престиж — всё обнулится!')) return;
  }
  else if (cmd === 'pad') {
    payload.idx = parseInt(document.getElementById('admPad').value) || 0;
    payload.value = parseInt(document.getElementById('admPadVal').value) || 0;
    payload.income = parseFloat(document.getElementById('admPadInc').value) || 0;
  } else if (cmd === 'pad_clear') {
    payload.cmd = 'pad';
    payload.idx = parseInt(document.getElementById('admPad').value) || 0;
    payload.value = 0;
    payload.income = 0;
  }
  socket.emit('admin_cmd', payload, (resp) => {});
};

window.adminSubmit = function() {
  const pwd = document.getElementById('adminPass').value;
  socket.emit('admin_auth', { password: pwd }, (resp) => {
    if (resp && resp.ok) {
      isAdmin = true;
      document.getElementById('adminAuthBox').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
    } else {
      document.getElementById('adminErr').textContent = (resp && resp.err) || 'Неверно';
    }
  });
};

window.admLoad = function() {
  const nick = document.getElementById('admNick').value.trim() || (serverData.players[me] && serverData.players[me].name) || '';
  socket.emit('admin_get_player', { nick }, (resp) => {
    if (resp && resp.ok) {
      const d = resp.data;
      document.getElementById('admMoney').value = d.money;
      document.getElementById('admInc').value = d.income_bonus;
      document.getElementById('admSpeed').value = d.speed_bonus;
      document.getElementById('admSlots').value = d.base_slots || 10;
      showToast('Загружено: ' + d.nick);
    } else {
      showToast((resp && resp.err) || 'Не найден', true);
    }
  });
};

window.closeSettings = function(){ document.getElementById('settingsModal').classList.remove('active'); };

// ============================================================
//  КНОПКИ
// ============================================================
document.getElementById('btnPad').addEventListener('click', window.upgradeBase);

// ПРЕСТИЖ
const prestigeModal = document.getElementById('prestigeModal');
const prestigeInfo = document.getElementById('prestigeInfo');
const prestigeConfirmBtn = document.getElementById('prestigeConfirmBtn');

function openPrestigeModal() {
  const my = serverData.players[me];
  if (!my) return;
  const curPrestige = my.prestige || 0;
  const curMult = (my.income_multiplier || 1).toFixed(1);
  const nextPrestige = curPrestige + 1;
  const nextMult = (1 + 0.5 * nextPrestige).toFixed(1);
  const threshold = my.prestige_threshold;
  const curBonus = my.speed_pct - 100;
  const padsUsed = (my.base_pads || []).filter(Boolean).length;
  const can = my.can_prestige;

  prestigeInfo.innerHTML =
    `<b>Текущий престиж:</b> ${curPrestige}<br>` +
    `<b>Множитель сейчас:</b> ×${curMult}<br>` +
    `<b>Следующий престиж:</b> ${nextPrestige} → ×${nextMult}<br>` +
    `<hr style="margin:10px 0">` +
    `<b>Нужно скорости:</b> +${threshold}%<br>` +
    `<b>У тебя сейчас:</b> +${curBonus}% ${can ? '✅' : '❌'}<br>` +
    `<hr style="margin:10px 0">` +
    `⚠ <b>Потеряешь:</b><br>` +
    `• скорость: +${curBonus}%<br>` +
    `• деньги: ${fmt(my.money)}💰<br>` +
    `• верити на базе: ${padsUsed} шт.<br>` +
    `• цены в магазине сбросятся`;

  prestigeConfirmBtn.disabled = !can;
  prestigeConfirmBtn.textContent = can
    ? `Подтвердить престиж ${nextPrestige} → ×${nextMult}`
    : `Нужно ещё +${Math.max(0, threshold - curBonus)}%`;
  prestigeModal.classList.add('active');
}

document.getElementById('btnPrestige').addEventListener('click', openPrestigeModal);
document.getElementById('prestigeClose').addEventListener('click', () => {
  prestigeModal.classList.remove('active');
});
prestigeModal.addEventListener('click', (e) => {
  if (e.target.id === 'prestigeModal') prestigeModal.classList.remove('active');
});
prestigeConfirmBtn.addEventListener('click', () => {
  socket.emit('do_prestige', {}, (resp) => {
    if (resp && resp.ok) prestigeModal.classList.remove('active');
  });
});

document.getElementById('shopClose').addEventListener('click', () => {
  socket.emit('close_shop');
});
document.getElementById('shopModal').addEventListener('click', e => {
  if (e.target.id === 'shopModal') socket.emit('close_shop');
});
document.querySelectorAll('.sc-btn').forEach(btn => {
  btn.addEventListener('click', () => buySpeed(parseInt(btn.dataset.kind)));
});

// ============================================================
//  AUTH UI
// ============================================================
let authTab = 'login';
document.querySelectorAll('.auth-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    authTab = t.dataset.tab;
    document.getElementById('authSubmit').textContent = authTab === 'login' ? 'Войти' : 'Создать';
    document.getElementById('authErr').textContent = '';
  });
});
document.getElementById('authSubmit').addEventListener('click', () => {
  const nick = document.getElementById('authNick').value.trim();
  const pass = document.getElementById('authPass').value;
  if (!nick || !pass) { document.getElementById('authErr').textContent = 'Заполни всё'; return; }
  if (nick.length < 2) { document.getElementById('authErr').textContent = 'Ник слишком короткий'; return; }
  if (pass.length < 3) { document.getElementById('authErr').textContent = 'Пароль минимум 3 символа'; return; }
  document.getElementById('authErr').textContent = 'Подожди...';
  socket.emit('auth', { nick, password: pass, is_new: authTab === 'register' });
});
document.getElementById('authPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('authSubmit').click();
});
document.getElementById('authNick').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('authPass').focus();
});
document.getElementById('authTogglePass').addEventListener('click', () => {
  const inp = document.getElementById('authPass');
  const btn = document.getElementById('authTogglePass');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
});
document.getElementById('adminTogglePass').addEventListener('click', () => {
  const inp = document.getElementById('adminPass');
  const btn = document.getElementById('adminTogglePass');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
});
document.getElementById('adminSubmit').addEventListener('click', window.adminSubmit);
document.getElementById('admLoad').addEventListener('click', window.admLoad);
document.getElementById('adminClose').addEventListener('click', () => {
  document.getElementById('adminModal').classList.remove('active');
});
document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('active');
});
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.add('active');
});

document.getElementById('setChatOn').checked = chatShow;
document.getElementById('setChatHead').checked = chatHead;
document.getElementById('setDur').value = chatDur;
document.getElementById('setDurVal').textContent = chatDur;
document.getElementById('setChatOn').addEventListener('change', e => {
  chatShow = e.target.checked; if (!chatShow) chatLog.innerHTML = '';
  try { localStorage.setItem('br_chatShow', chatShow); } catch(_){}
});
document.getElementById('setDur').addEventListener('input', e => {
  chatDur = parseInt(e.target.value);
  document.getElementById('setDurVal').textContent = chatDur;
  try { localStorage.setItem('br_chatDur', chatDur); } catch(_){}
});
document.getElementById('setChatHead').addEventListener('change', e => {
  chatHead = e.target.checked;
  try { localStorage.setItem('br_chatHead', chatHead); } catch(_){}
});

// ============================================================
//  ВВОД
// ============================================================
const keys = { w:false, s:false, a:false, d:false, dx:0, dz:0 };
let speedLimit = null;
let holdE = false, holdD = false, prevHoldE = false;
let camYaw = 0, camPitch = 0.28, rmbDown = false;
let chatFocused = false;

const canvas = document.getElementById('game');
if (canvas) {
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (chatFocused) return;
    if (e.button === 2) {
      rmbDown = true;
      if (canvas.requestPointerLock) canvas.requestPointerLock();
    }
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 2) {
      rmbDown = false;
      if (document.exitPointerLock) document.exitPointerLock();
    }
  });
  document.addEventListener('mousemove', e => {
    if (!rmbDown || chatFocused) return;
    camYaw -= e.movementX * 0.004;
    camPitch -= e.movementY * 0.004;
    camPitch = Math.max(-0.35, Math.min(0.9, camPitch));
  });
}

function sendInput(extra) {
  socket.emit('input', {
    dx: keys.dx, dz: keys.dz,
    hold_e: holdE, hold_d: holdD,
    speed_limit: speedLimit,
    ...(extra || {})
  });
}
function recompute() {
  let dx = 0, dz = 0;
  if (keys.w) dx += 1;
  if (keys.s) dx -= 1;
  if (keys.a) dz -= 1;
  if (keys.d) dz += 1;
  keys.dx = dx; keys.dz = dz;
  sendInput();
}
const K = e => e.key.toLowerCase();
addEventListener('keydown', e => {
  if (chatFocused) return;
  const k = K(e);
  if (['w','ц','arrowup'].includes(k)) keys.w = true;
  if (['s','ы','arrowdown'].includes(k)) keys.s = true;
  if (['a','ф','arrowleft'].includes(k)) keys.a = true;
  if (['d','в','arrowright'].includes(k)) keys.d = true;
  if (k === ' ') { e.preventDefault(); sendInput({ jump: true }); return; }
  if (k === 't' || k === 'е') { e.preventDefault(); openChat(); return; }
  if (k === 'e' || k === 'у') {
    holdE = true;
    if (!prevHoldE) {
      const p = serverData.players[me];
      if (p && p.shop_open) socket.emit('close_shop');
    }
    prevHoldE = true;
  }
  if (k === 'd' || k === 'в') holdD = true;
  recompute();
});
addEventListener('keyup', e => {
  if (chatFocused) return;
  const k = K(e);
  if (['w','ц','arrowup'].includes(k)) keys.w = false;
  if (['s','ы','arrowdown'].includes(k)) keys.s = false;
  if (['a','ф','arrowleft'].includes(k)) keys.a = false;
  if (['d','в','arrowright'].includes(k)) keys.d = false;
  if (k === 'e' || k === 'у') { holdE = false; prevHoldE = false; }
  if (k === 'd' || k === 'в') holdD = false;
  recompute();
});
setInterval(() => sendInput(), 120);

function openChat() {
  chatFocused = true;
  const w = document.getElementById('chatInputWrap');
  w.classList.add('active');
  const inp = document.getElementById('chatInput');
  inp.value = '';
  setTimeout(() => inp.focus(), 10);
  keys.dx = 0; keys.dz = 0; sendInput();
}
function closeChat() {
  chatFocused = false;
  document.getElementById('chatInputWrap').classList.remove('active');
  document.getElementById('chatInput').blur();
}
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) socket.emit('chat', { text: v });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
  e.stopPropagation();
});

// ============================================================
//  ПЕРЕКЛЮЧАТЕЛЬ СКОРОСТИ
// ============================================================
const ssWrap = document.getElementById('speedSwitch');
const ssNormal = document.getElementById('ssNormal');
const ssCustom = document.getElementById('ssCustom');
const ssSliderWrap = document.getElementById('ssSliderWrap');
const ssSlider = document.getElementById('ssSlider');
const ssSliderVal = document.getElementById('ssSliderVal');

function refreshSpeedSwitch() {
  const p = serverData.players[me];
  if (!p) return;
  const maxPct = p.speed_pct || 100;

  if (maxPct < 150) {
    ssWrap.classList.remove('active');
    if (speedLimit !== null) {
      speedLimit = null;
      sendInput();
    }
    return;
  }

  ssWrap.classList.add('active');
  ssSlider.max = maxPct;

  if (speedLimit === null) {
    ssNormal.classList.remove('on');
    ssCustom.classList.remove('on');
    ssSliderWrap.classList.remove('active');
    ssSliderVal.textContent = 'MAX ' + maxPct + '%';
  } else if (speedLimit === 100) {
    ssNormal.classList.add('on');
    ssCustom.classList.remove('on');
    ssSliderWrap.classList.remove('active');
    ssSliderVal.textContent = '100%';
  } else {
    ssNormal.classList.remove('on');
    ssCustom.classList.add('on');
    ssSliderWrap.classList.add('active');
    if (parseInt(ssSlider.value) !== speedLimit) ssSlider.value = speedLimit;
    ssSliderVal.textContent = speedLimit + '%';
  }
}
ssNormal.addEventListener('click', () => { speedLimit = 100; sendInput(); refreshSpeedSwitch(); });
ssCustom.addEventListener('click', () => {
  const maxPct = (serverData.players[me] && serverData.players[me].speed_pct) || 100;
  if (speedLimit === null || speedLimit === 100) speedLimit = maxPct;
  sendInput(); refreshSpeedSwitch();
});
ssSlider.addEventListener('input', () => {
  speedLimit = parseInt(ssSlider.value);
  ssSliderVal.textContent = speedLimit + '%';
  sendInput();
});
setInterval(refreshSpeedSwitch, 200);

// ============================================================
//  HUD ОБНОВЛЕНИЕ
// ============================================================
setInterval(() => {
  const my = serverData.players[me];
  if (!my) return;

  const stateLabel = { ground: '🏃 на земле', pit: '🕳 в яме' }[my.state] || my.state;
  document.getElementById('hud').innerHTML =
    `<b>${my.name}</b><br>` +
    `💰 <b>${fmt(my.money)}</b><br>` +
    `<span style="color:#7dff7d">⚡ +${fmt(my.income_sec)}/сек</span><br>` +
    `🎒 ${my.carry_n}/1<br>` +
    `📍 ${Math.floor(my.x)} м<br>` +
    `${stateLabel}<br>` +
    (my.prestige > 0
      ? `⭐ Престиж <b>${my.prestige}</b> · ×${(my.income_multiplier || 1).toFixed(1)}<br>`
      : '') +
    `<span class="hint">WASD · SPACE · T — чат · E — действия</span>`;
  document.getElementById('speedChip').innerHTML =
    `⚡ ${my.speed_pct_active || my.speed_pct}% / ${my.speed_pct}%`;

  const topList = serverData.top || [];
  document.getElementById('board').innerHTML =
    '<b>🏆 Топ</b><br>' +
    topList.slice(0, 8).map((pl, i) => {
      const medal = ['🥇','🥈','🥉'][i] || (i+1) + '.';
      const isMe = pl.name === my.name;
      return `${medal} ${isMe ? '<b>' : ''}${pl.name}${isMe ? '</b>' : ''} — ${fmt(pl.money)}💰`;
    }).join('<br>');

  const btnPad = document.getElementById('btnPad');
  if (btnPad) {
    const full = my.base_slots >= MAX_PADS;
    btnPad.disabled = full;
    btnPad.textContent = full ? '🏁 50/50' : `🏠 +1 Пэд (${fmt(my.base_upgrade_cost)}💰)`;
  }

  const btnPrestige = document.getElementById('btnPrestige');
  if (btnPrestige) {
    btnPrestige.style.display = 'block';
    const curBonus = my.speed_pct - 100;
    const threshold = my.prestige_threshold;
    if (my.can_prestige) {
      btnPrestige.textContent = `⭐ Престиж ${my.prestige + 1} доступен!`;
      btnPrestige.style.background = 'linear-gradient(180deg,#f1c40f,#d68910)';
      btnPrestige.style.color = '#000';
    } else {
      btnPrestige.textContent = `⭐ Престиж (${curBonus}/${threshold})`;
      btnPrestige.style.background = 'linear-gradient(180deg,#666,#444)';
      btnPrestige.style.color = '#aaa';
    }
  }

  // Плашка E/D (только на ПК)
  if (!isTouchDevice) {
    const wrap = document.getElementById('actionWrap');
    const label = document.getElementById('actionLabel');
    const bar = document.getElementById('actionBar');
    const fill = document.getElementById('actionFill');
    let hint = null, progress = 0;
    if (my.shop_open) hint = null;
    else if (my.near_shop) { hint = '🏪 Зажмите <b>E</b> — открыть магазин'; progress = my.shop_progress; }
    else if (my.near_brainrot) { hint = '📦 Зажмите <b>E</b> — подобрать верити'; progress = my.pick_progress; }
    else if (my.place_progress > 0) { hint = '🏠 Поставить на пэд...'; progress = my.place_progress; }
    else if (my.destroy_idx >= 0) { hint = '🗑 Зажмите <b>D</b> — удалить верити'; progress = my.destroy_progress; }
    if (hint) {
      wrap.classList.add('active');
      label.innerHTML = hint;
      bar.style.display = 'block';
      fill.style.width = Math.round(progress * 100) + '%';
    } else {
      wrap.classList.remove('active');
    }
  }

  const shopModal = document.getElementById('shopModal');
  if (my.shop_open) {
    shopModal.classList.add('active');
    document.getElementById('shopSpeedVal').textContent = my.speed_pct + '%';
    document.getElementById('scp1').textContent = fmt(my.cost_1) + '💰';
    document.getElementById('scp5').textContent = fmt(my.cost_5) + '💰';
    document.getElementById('scp10').textContent = fmt(my.cost_10) + '💰';
    document.querySelectorAll('.sc-btn').forEach(btn => {
      const kind = parseInt(btn.dataset.kind);
      const cost = kind === 1 ? my.cost_1 : kind === 5 ? my.cost_5 : my.cost_10;
      btn.disabled = my.money < cost;
    });
  } else {
    shopModal.classList.remove('active');
  }
}, 100);

// ============================================================
//  МОБИЛЬНОЕ УПРАВЛЕНИЕ
// ============================================================
if (isTouchDevice) {
  // ---------- ДЖОЙСТИК ----------
  const joy = document.getElementById('joystick');
  const knob = document.getElementById('joystickKnob');
  let joyActive = false;
  let joyId = null;
  let centerX = 0, centerY = 0;

  function joyStart(e) {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    joyActive = true;
    const r = joy.getBoundingClientRect();
    centerX = r.left + r.width / 2;
    centerY = r.top + r.height / 2;
    joyMove(e);
  }
  function joyMove(e) {
    if (!joyActive) return;
    const t = Array.from(e.changedTouches).find(x => x.identifier === joyId);
    if (!t) return;
    const dx = t.clientX - centerX;
    const dy = t.clientY - centerY;
    const r = joy.offsetWidth / 2;
    const dist = Math.min(Math.hypot(dx, dy), r);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist;
    const ky = Math.sin(angle) * dist;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

    const nx = kx / r;
    const ny = ky / r;
    keys.dx = Math.abs(nx) > 0.3 ? (nx > 0 ? 1 : -1) : 0;
    keys.dz = Math.abs(ny) > 0.3 ? (ny > 0 ? 1 : -1) : 0;
    sendInput();
  }
  function joyEnd(e) {
    const t = Array.from(e.changedTouches).find(x => x.identifier === joyId);
    if (!t) return;
    joyActive = false; joyId = null;
    knob.style.transform = 'translate(-50%,-50%)';
    keys.dx = 0; keys.dz = 0;
    sendInput();
  }
  joy.addEventListener('touchstart', joyStart, { passive: true });
  joy.addEventListener('touchmove', joyMove, { passive: true });
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // ---------- КНОПКА ПРЫЖКА ----------
  document.getElementById('mobJump').addEventListener('touchstart', (e) => {
    e.preventDefault();
    sendInput({ jump: true });
  });

  // ---------- ВСПЛЫВАЮЩИЕ КНОПКИ ДЕЙСТВИЙ ----------
  const mobE = document.getElementById('mobActionE');
  const mobD = document.getElementById('mobActionD');
  const mobEIcon = document.getElementById('mobActionEIcon');
  const mobELabel = document.getElementById('mobActionELabel');
  const mobDIcon = document.getElementById('mobActionDIcon');
  const mobDLabel = document.getElementById('mobActionDLabel');
  const mobProgressE = document.getElementById('mobProgressE').firstElementChild;
  const mobProgressD = document.getElementById('mobProgressD').firstElementChild;

  mobE.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const p = serverData.players[me];
    if (p && p.shop_open) {
      socket.emit('close_shop');
      return;
    }
    holdE = true;
    sendInput();
  });
  mobE.addEventListener('touchend', (e) => {
    e.preventDefault();
    holdE = false;
    sendInput();
  });
  mobE.addEventListener('touchcancel', () => { holdE = false; sendInput(); });

  mobD.addEventListener('touchstart', (e) => {
    e.preventDefault();
    holdD = true;
    sendInput();
  });
  mobD.addEventListener('touchend', (e) => {
    e.preventDefault();
    holdD = false;
    sendInput();
  });
  mobD.addEventListener('touchcancel', () => { holdD = false; sendInput(); });

  // ---------- КАМЕРА (свайп) ----------
  let camTouchId = null;
  let camLastX = 0, camLastY = 0;
  document.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.target.closest('#joystick') ||
          t.target.closest('#mobileButtons') ||
          t.target.closest('.mob-action-btn')) continue;
      if (camTouchId === null) {
        camTouchId = t.identifier;
        camLastX = t.clientX;
        camLastY = t.clientY;
      }
    }
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== camTouchId) continue;
      const dx = t.clientX - camLastX;
      const dy = t.clientY - camLastY;
      camYaw -= dx * 0.006;
      camPitch -= dy * 0.006;
      camPitch = Math.max(-0.35, Math.min(0.9, camPitch));
      camLastX = t.clientX;
      camLastY = t.clientY;
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === camTouchId) camTouchId = null;
    }
  });

  // ---------- ОБНОВЛЕНИЕ ВИДИМОСТИ КНОПОК ----------
  setInterval(() => {
    const my = serverData.players[me];
    if (!my) return;

    const canShop = my.near_shop && !my.shop_open;
    const canCloseShop = my.shop_open;
    const canPick = my.near_brainrot && !my.shop_open;

    if (canCloseShop) {
      mobE.style.display = 'flex';
      mobEIcon.textContent = '❌';
      mobELabel.textContent = 'Закрыть';
      mobProgressE.style.width = '0%';
    } else if (canShop) {
      mobE.style.display = 'flex';
      mobEIcon.textContent = '🏪';
      mobELabel.textContent = 'Магазин';
      mobProgressE.style.width = Math.round((my.shop_progress || 0) * 100) + '%';
    } else if (canPick) {
      mobE.style.display = 'flex';
      mobEIcon.textContent = '📦';
      mobELabel.textContent = 'Подобрать';
      mobProgressE.style.width = Math.round((my.pick_progress || 0) * 100) + '%';
    } else {
      mobE.style.display = 'none';
    }

    if (my.destroy_idx >= 0) {
      mobD.style.display = 'flex';
      mobDIcon.textContent = '🗑';
      mobDLabel.textContent = 'Удалить';
      mobProgressD.style.width = Math.round((my.destroy_progress || 0) * 100) + '%';
    } else {
      mobD.style.display = 'none';
    }
  }, 100);
}

// ============================================================
//  3D СЦЕНА
// ============================================================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 160, 500);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 900);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.68));
scene.add(new THREE.HemisphereLight(0xbbddff, 0x3a5a2a, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SS = 100;
sun.shadow.camera.left = -SS; sun.shadow.camera.right = SS;
sun.shadow.camera.top = SS; sun.shadow.camera.bottom = -SS;
sun.shadow.camera.far = 300;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

function makeLabelSprite(text, color='#fff', bg='rgba(0,0,0,0.55)', w=640, h=160, fs=74) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const draw = (t, col) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = bg; const r = 28;
    c.beginPath();
    c.moveTo(r, 0); c.lineTo(w - r, 0); c.quadraticCurveTo(w, 0, w, r);
    c.lineTo(w, h - r); c.quadraticCurveTo(w, h, w - r, h);
    c.lineTo(r, h); c.quadraticCurveTo(0, h, 0, h - r);
    c.lineTo(0, r); c.quadraticCurveTo(0, 0, r, 0);
    c.closePath(); c.fill();
    c.fillStyle = col || color;
    c.font = `bold ${fs}px system-ui,sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(t, w / 2, h / 2 + 4);
  };
  draw(text);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.userData = { draw, texture: tex };
  return spr;
}
function redrawLabel(spr, text, col) {
  spr.userData.draw(text, col);
  spr.userData.texture.needsUpdate = true;
}
function redrawMulti(spr, lines) {
  const cv = spr.material.map.image, c = cv.getContext('2d'), w = cv.width, h = cv.height;
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(0,0,0,0.55)'; const r = 28;
  c.beginPath();
  c.moveTo(r, 0); c.lineTo(w - r, 0); c.quadraticCurveTo(w, 0, w, r);
  c.lineTo(w, h - r); c.quadraticCurveTo(w, h, w - r, h);
  c.lineTo(r, h); c.quadraticCurveTo(0, h, 0, h - r);
  c.lineTo(0, r); c.quadraticCurveTo(0, 0, r, 0);
  c.closePath(); c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 44px system-ui,sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(lines[0] || '', w / 2, 55);
  c.fillStyle = '#7dff7d';
  c.font = 'bold 34px system-ui,sans-serif';
  c.fillText(lines[1] || '', w / 2, 130);
  spr.material.map.needsUpdate = true;
}
function makeMultiline(lines, w=512, h=384) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const draw = (lns) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(15,15,25,0.85)'; const r = 24;
    c.beginPath();
    c.moveTo(r, 0); c.lineTo(w - r, 0); c.quadraticCurveTo(w, 0, w, r);
    c.lineTo(w, h - r); c.quadraticCurveTo(w, h, w - r, h);
    c.lineTo(r, h); c.quadraticCurveTo(0, h, 0, h - r);
    c.lineTo(0, r); c.quadraticCurveTo(0, 0, r, 0);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,220,80,0.7)'; c.lineWidth = 4; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < lns.length; i++) {
      const l = lns[i];
      c.fillStyle = l.color || '#fff';
      c.font = `bold ${l.size || 38}px system-ui,sans-serif`;
      c.fillText(l.text, w / 2, 50 + i * 52);
    }
  };
  draw(lines);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.userData = { draw, texture: tex };
  return spr;
}

// ТЕРРЕЙН
let terrainGroup = null, lastTerrainKey = '';
function makeGrassTex() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#4a8f3a'; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    const sh = Math.random() * 40;
    c.fillStyle = `rgba(${60+sh},${130+sh},${50+sh},0.7)`;
    c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 8);
  return tex;
}
const grassTex = makeGrassTex();

function rebuildTerrain(pits) {
  const key = pits.map(p => `${p.x}:${p.w}`).join(',');
  if (key === lastTerrainKey) return;
  lastTerrainKey = key;
  if (terrainGroup) {
    terrainGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    scene.remove(terrainGroup);
  }
  terrainGroup = new THREE.Group();
  const shape = new THREE.Shape();
  const pts = [
    [SAFE_X_MIN, -SAFE_Z_HALF], [SAFE_X_MAX, -SAFE_Z_HALF],
    [SAFE_X_MAX, -LANE_HALF], [4000, -LANE_HALF],
    [4000, LANE_HALF], [SAFE_X_MAX, LANE_HALF],
    [SAFE_X_MAX, SAFE_Z_HALF], [SAFE_X_MIN, SAFE_Z_HALF]
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  for (const pit of pits) {
    if (pit.x < ROAD_START_X) continue;
    const h = new THREE.Path();
    h.moveTo(pit.x, -LANE_HALF); h.lineTo(pit.x + pit.w, -LANE_HALF);
    h.lineTo(pit.x + pit.w, LANE_HALF); h.lineTo(pit.x, LANE_HALF);
    h.closePath();
    shape.holes.push(h);
  }
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshLambertMaterial({ color: 0x5faa48, map: grassTex, side: THREE.DoubleSide });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  terrainGroup.add(ground);

  const pitMat = new THREE.MeshLambertMaterial({ color: 0x2c2318, side: THREE.DoubleSide });
  for (const pit of pits) {
    if (pit.x < ROAD_START_X) continue;
    const w = pit.w, d = LANE_HALF * 2;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pitMat);
    b.position.set(pit.x + w / 2, -PIT_DEPTH, 0);
    b.rotation.x = -Math.PI / 2;
    terrainGroup.add(b);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(d, PIT_DEPTH), pitMat);
    f.position.set(pit.x, -PIT_DEPTH / 2, 0);
    f.rotation.y = -Math.PI / 2;
    terrainGroup.add(f);
    const bk = new THREE.Mesh(new THREE.PlaneGeometry(d, PIT_DEPTH), pitMat);
    bk.position.set(pit.x + w, -PIT_DEPTH / 2, 0);
    bk.rotation.y = Math.PI / 2;
    terrainGroup.add(bk);
    const lw = new THREE.Mesh(new THREE.PlaneGeometry(w, PIT_DEPTH), pitMat);
    lw.position.set(pit.x + w / 2, -PIT_DEPTH / 2, -LANE_HALF);
    terrainGroup.add(lw);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(w, PIT_DEPTH), pitMat);
    rw.position.set(pit.x + w / 2, -PIT_DEPTH / 2, LANE_HALF);
    rw.rotation.y = Math.PI;
    terrainGroup.add(rw);
  }
  scene.add(terrainGroup);
}

// ЗАБОРЫ
const fenceMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
function addFence(x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.4), fenceMat);
  m.position.set((x1 + x2) / 2, 0.7, (z1 + z2) / 2);
  m.rotation.y = Math.atan2(-dz, dx);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
addFence(SAFE_X_MIN, -SAFE_Z_HALF, SAFE_X_MAX, -SAFE_Z_HALF);
addFence(SAFE_X_MIN, SAFE_Z_HALF, SAFE_X_MAX, SAFE_Z_HALF);
addFence(SAFE_X_MIN, -SAFE_Z_HALF, SAFE_X_MIN, SAFE_Z_HALF);
addFence(SAFE_X_MAX, -SAFE_Z_HALF, SAFE_X_MAX, -LANE_HALF);
addFence(SAFE_X_MAX, LANE_HALF, SAFE_X_MAX, SAFE_Z_HALF);
addFence(SAFE_X_MAX, -LANE_HALF, 4000, -LANE_HALF);
addFence(SAFE_X_MAX, LANE_HALF, 4000, LANE_HALF);

{
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const line = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, LANE_HALF * 2), redMat);
  line.position.set(ROAD_START_X, 0.05, 0);
  scene.add(line);
  const lbl = makeLabelSprite('🚦 СТАРТ', '#fff', 'rgba(220,40,40,0.9)', 400, 110, 60);
  lbl.position.set(ROAD_START_X + 10, 5, -LANE_HALF - 4);
  lbl.scale.set(7, 2, 1);
  scene.add(lbl);
}

// БАЗА
const baseGroup = new THREE.Group(); scene.add(baseGroup);
const WALL_H = 12, BASE_W = 32, BASE_D = 32, BASE_CX = 16;
const wallMat = new THREE.MeshLambertMaterial({ color: 0xb9b9c8 });
const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b3a2e });
const floorMat = new THREE.MeshLambertMaterial({ color: 0x7a7a8a });

const baseFloor = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, 0.4, BASE_D), floorMat);
baseFloor.position.set(BASE_CX, 0.2, 0);
baseFloor.receiveShadow = true;
baseGroup.add(baseFloor);

const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, WALL_H, BASE_D), wallMat);
backWall.position.set(0.3, WALL_H / 2 + 0.4, 0);
backWall.castShadow = backWall.receiveShadow = true;
baseGroup.add(backWall);

for (const zp of [-BASE_D / 2 + 0.3, BASE_D / 2 - 0.3]) {
  const sw = new THREE.Mesh(new THREE.BoxGeometry(BASE_W, WALL_H, 0.6), wallMat);
  sw.position.set(BASE_CX, WALL_H / 2 + 0.4, zp);
  sw.castShadow = sw.receiveShadow = true;
  baseGroup.add(sw);
}
const frontX = BASE_W - 0.3, doorW = 10, sideW = (BASE_D - doorW) / 2;
for (const zS of [-1, 1]) {
  const seg = new THREE.Mesh(new THREE.BoxGeometry(0.6, WALL_H, sideW), wallMat);
  seg.position.set(frontX, WALL_H / 2 + 0.4, zS * (doorW / 2 + sideW / 2));
  seg.castShadow = seg.receiveShadow = true;
  baseGroup.add(seg);
}
const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, doorW), wallMat);
lintel.position.set(frontX, WALL_H - 1.1, 0);
lintel.castShadow = true;
baseGroup.add(lintel);

const roof = new THREE.Mesh(new THREE.BoxGeometry(BASE_W + 2, 1.2, BASE_D + 2), roofMat);
roof.position.set(BASE_CX, WALL_H + 1, 0);
roof.castShadow = roof.receiveShadow = true;
baseGroup.add(roof);

const baseSign = makeLabelSprite('🏠 БАЗА', '#ffffff', 'rgba(180,60,40,0.9)');
baseSign.position.set(BASE_CX, WALL_H + 3.5, 0);
baseSign.scale.set(14, 3.5, 1);
baseGroup.add(baseSign);

// ПЭДЫ
const padGroup = new THREE.Group(); scene.add(padGroup);
const padEmptyMat = new THREE.MeshBasicMaterial({ color: 0x6666aa, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
const padSelectedMat = new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
const padEmptyGeo = new THREE.RingGeometry(1.5, 1.9, 32);
const padMeshes = [];
for (let i = 0; i < MAX_PADS; i++) {
  const pos = padPos(i);
  const m = new THREE.Mesh(padEmptyGeo, padEmptyMat.clone());
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, 0.42, pos.z);
  m.userData.padIndex = i;
  padGroup.add(m);
  padMeshes.push(m);
}

// ВЕРИТИ
const basePadMeshes = new Map(), basePadLabels = new Map();

function makeSmileyVarity(color, scale, sparkle) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1.05 * scale, 24, 24),
    new THREE.MeshLambertMaterial({ color, emissive: sparkle ? 0x443300 : 0x221100 })
  );
  body.position.y = 1.4 * scale;
  body.castShadow = true;
  g.add(body);
  const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeB = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const zo of [-0.36 * scale, 0.36 * scale]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 10, 10), eyeW);
    w.position.set(0.85 * scale, 1.6 * scale, zo);
    g.add(w);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.11 * scale, 10, 10), eyeB);
    e.position.set(0.97 * scale, 1.58 * scale, zo);
    g.add(e);
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.32 * scale, 0.07 * scale, 8, 16, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  smile.position.set(0.95 * scale, 1.15 * scale, 0);
  smile.rotation.z = -Math.PI / 2;
  smile.rotation.y = Math.PI / 2;
  g.add(smile);
  return g;
}

function makeBrainrotMesh(income, sparkle) {
  const g = makeSmileyVarity(0xffcc33, 1, sparkle);
  const col = sparkle ? '#c88aff' : '#ffe066';
  const bg = sparkle ? 'rgba(60,20,90,0.85)' : 'rgba(0,0,0,0.65)';
  const lbl = makeLabelSprite(`+${fmt(income)}/сек`, col, bg, 480, 110, 56);
  lbl.position.set(0, 3.6, 0);
  lbl.scale.set(3.6, 0.85, 1);
  g.add(lbl);
  g.userData.labelSprite = lbl;
  g.userData.lastTxt = '';
  g.userData.sparkle = sparkle;
  if (sparkle) {
    const parts = [];
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })
      );
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI, r = 1.3;
      p.position.set(Math.sin(b) * Math.cos(a) * r, 1.4 + Math.cos(b) * r * 0.8, Math.sin(b) * Math.sin(a) * r);
      p.userData.phase = Math.random() * Math.PI * 2;
      p.userData.baseY = p.position.y;
      parts.push(p);
      g.add(p);
    }
    g.userData.particles = parts;
  }
  return g;
}

function ensurePadVisual(idx, value, income, sparkle) {
  let mesh = basePadMeshes.get(idx);
  if (!mesh) {
    const pos = padPos(idx);
    mesh = makeSmileyVarity(0xffcc33, 0.85, sparkle);
    mesh.position.set(pos.x, 0.4, pos.z);
    padGroup.add(mesh);
    basePadMeshes.set(idx, mesh);
    const col = sparkle ? '#c88aff' : '#ffe066';
    const bg = sparkle ? 'rgba(60,20,90,0.85)' : 'rgba(0,0,0,0.7)';
    const lbl = makeLabelSprite(`+${fmt(income)}/сек`, col, bg, 420, 100, 52);
    lbl.position.set(pos.x, 3.0, pos.z);
    lbl.scale.set(2.6, 0.65, 1);
    padGroup.add(lbl);
    basePadLabels.set(idx, lbl);
  }
  const txt = `+${fmt(income)}/сек`;
  const lbl = basePadLabels.get(idx);
  if (lbl && lbl.userData.lastTxt !== txt) {
    redrawLabel(lbl, txt);
    lbl.userData.lastTxt = txt;
  }
}
function removePadVisual(idx) {
  const m = basePadMeshes.get(idx);
  if (m) { padGroup.remove(m); basePadMeshes.delete(idx); }
  const l = basePadLabels.get(idx);
  if (l) { padGroup.remove(l); basePadLabels.delete(idx); }
}

// МАГАЗИН
const shopGroup = new THREE.Group();
{
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x9b59b6 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 1.2), bodyMat);
  body.position.y = 1.9; body.castShadow = true;
  shopGroup.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), headMat);
  head.position.y = 3.3; head.castShadow = true;
  shopGroup.add(head);
  const sign = makeLabelSprite('🏪 МАГАЗИН', '#ffffff', 'rgba(140,60,180,0.9)');
  sign.position.set(0, 5.2, 0);
  sign.scale.set(9, 2.2, 1);
  shopGroup.add(sign);
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 0.06, 32),
    new THREE.MeshBasicMaterial({ color: 0x9b59b6, transparent: true, opacity: 0.35 })
  );
  marker.position.y = 0.03;
  shopGroup.add(marker);
  shopGroup.position.set(SHOP_X, 0, SHOP_Z);
  scene.add(shopGroup);
}

// ГОЛОГРАММА ТОПА
const topBoard = makeMultiline([{ text: '🏆 ТОП', size: 42, color: '#ffe066' }]);
topBoard.position.set(35, 14, 30);
topBoard.scale.set(14, 10, 1);
scene.add(topBoard);
let lastTopJson = '';

// ПЕРСОНАЖ
function makeHumanoid(shirtColor, isMe) {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf5cba7 });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const zo of [-0.32, 0.32]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 0.55), pantsMat);
    l.position.set(0, 0.65, zo);
    l.castShadow = true;
    g.add(l);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.4, 1.35), shirtMat);
  torso.position.set(0, 2.0, 0);
  torso.castShadow = true;
  g.add(torso);
  for (const zo of [-0.95, 0.95]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), shirtMat);
    a.position.set(0, 2.0, zo);
    a.castShadow = true;
    g.add(a);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), skinMat);
  head.position.set(0, 3.25, 0);
  head.castShadow = true;
  g.add(head);
  for (const zo of [-0.28, 0.28]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), eyeW);
    w.position.set(0.53, 3.35, zo);
    g.add(w);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeMat);
    e.position.set(0.64, 3.34, zo);
    g.add(e);
  }
  if (isMe) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.45, 32),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.75, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);
  }
  return g;
}
function makeWallMesh(color, label, zWidth) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 14, zWidth),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 7;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  for (let i = -3; i <= 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 14, 0.35), stripeMat);
    s.position.set(1.16, 7, i * (zWidth / 7));
    g.add(s);
  }
  const lbl = makeLabelSprite(label, '#ffffff');
  lbl.position.set(0, 15.5, 0);
  lbl.scale.set(3.2, 0.9, 1);
  g.add(lbl);
  return g;
}

// СОСТОЯНИЯ
const playerStates = new Map();
const wallStates = new Map();
const brainrotStates = new Map();
const playerGroup = new THREE.Group();
const wallGroup = new THREE.Group();
const brainrotGroup = new THREE.Group();
scene.add(playerGroup, wallGroup, brainrotGroup);

function updateFromServer() {
  const seen = new Set();
  for (const id in serverData.players) {
    const p = serverData.players[id];
    seen.add(id);
    let st = playerStates.get(id);
    const isMe = id === me;
    if (!st) {
      const mesh = makeHumanoid(isMe ? 0x00b8e5 : 0xe55599, isMe);
      playerGroup.add(mesh);
      st = {
        mesh,
        current: new THREE.Vector3(p.x, p.y || 0, p.z),
        target: new THREE.Vector3(p.x, p.y || 0, p.z),
        data: p, isMe, lastInfo: ''
      };
      playerStates.set(id, st);
    }
    st.target.set(p.x, p.y || 0, p.z);
    st.data = p;
  }
  for (const [id, st] of playerStates) {
    if (!seen.has(id)) { playerGroup.remove(st.mesh); playerStates.delete(id); }
  }

  const seenW = new Set();
  for (const w of serverData.walls) {
    seenW.add(w.id);
    let st = wallStates.get(w.id);
    if (!st) {
      const mesh = makeWallMesh(w.color, w.label, w.w);
      wallGroup.add(mesh);
      st = { mesh, current: new THREE.Vector3(w.x, 0, w.z), target: new THREE.Vector3(w.x, 0, w.z), data: w };
      wallStates.set(w.id, st);
    }
    st.target.set(w.x, 0, w.z);
    st.data = w;
  }
  for (const [id, st] of wallStates) {
    if (!seenW.has(id)) { wallGroup.remove(st.mesh); wallStates.delete(id); }
  }

  const seenB = new Set();
  for (const b of serverData.brainrots) {
    seenB.add(b.id);
    let st = brainrotStates.get(b.id);
    if (!st) {
      const mesh = makeBrainrotMesh(b.income, b.sparkle);
      brainrotGroup.add(mesh);
      st = {
        mesh,
        current: new THREE.Vector3(b.x, 0, b.z),
        target: new THREE.Vector3(b.x, 0, b.z),
        data: b,
        bobPhase: Math.random() * Math.PI * 2,
        lastTxt: ''
      };
      brainrotStates.set(b.id, st);
    }
    st.target.set(b.x, 0, b.z);
    st.data = b;
  }
  for (const [id, st] of brainrotStates) {
    if (!seenB.has(id)) { brainrotGroup.remove(st.mesh); brainrotStates.delete(id); }
  }
}

// ГЛАВНЫЙ ЦИКЛ
const camTarget = new THREE.Vector3(40, 10, 0);
const camLook = new THREE.Vector3(60, 2.5, 0);

function frame() {
  requestAnimationFrame(frame);
  const t = performance.now() / 1000;
  updateFromServer();
  const my = playerStates.get(me);

  for (const [id, st] of playerStates) {
    st.current.lerp(st.target, 0.55);
    st.mesh.position.copy(st.current);
    const dx = st.data.last_dx || 1;
    st.mesh.rotation.y = dx >= 0 ? 0 : Math.PI;
    if (st.data.state === 'pit') {
      st.mesh.position.y = st.data.y;
      st.mesh.scale.set(1, 0.6, 1);
    } else {
      st.mesh.position.y = st.data.y;
      st.mesh.scale.set(1, 1, 1);
    }

    let halo = st.mesh.getObjectByName('halo');
    if (st.data.carry_n > 0) {
      if (!halo) {
        halo = new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 14, 14),
          new THREE.MeshBasicMaterial({ color: 0xffcc33, wireframe: true, transparent: true, opacity: 0.45, depthWrite: false })
        );
        halo.name = 'halo';
        halo.position.y = 2.2;
        st.mesh.add(halo);
      }
    } else if (halo) st.mesh.remove(halo);

    if (!st.isMe) {
      let info = st.mesh.getObjectByName('info');
      const txt = `${st.data.name}\n💰${fmt(st.data.money)} · +${fmt(st.data.income_sec)}/сек`;
      if (!info) {
        info = makeLabelSprite('', '#fff', 'rgba(0,0,0,0.55)', 700, 200, 42);
        info.name = 'info';
        info.position.set(0, 5.6, 0);
        info.scale.set(5.6, 1.7, 1);
        st.mesh.add(info);
      }
      if (st.lastInfo !== txt) {
        redrawMulti(info, txt.split('\n'));
        st.lastInfo = txt;
      }
    }

    if (chatHead && st.data.chat_msg) {
      let c = st.mesh.getObjectByName('chat');
      if (!c) {
        c = makeLabelSprite('', '#fff', 'rgba(20,60,120,0.85)', 640, 110, 42);
        c.name = 'chat';
        c.position.set(0, 7.2, 0);
        c.scale.set(5.2, 1, 1);
        st.mesh.add(c);
      }
      if (c.userData.lastTxt !== st.data.chat_msg) {
        redrawLabel(c, st.data.chat_msg);
        c.userData.lastTxt = st.data.chat_msg;
      }
      c.visible = true;
    } else {
      const c = st.mesh.getObjectByName('chat');
      if (c) c.visible = false;
    }
  }

  for (const [, st] of wallStates) {
    st.current.lerp(st.target, 0.55);
    st.mesh.position.copy(st.current);
  }

  const myPos = my ? my.current : new THREE.Vector3();
  for (const [, st] of brainrotStates) {
    st.current.lerp(st.target, 0.4);
    st.mesh.position.copy(st.current);
    const body = st.mesh.children[0];
    if (body) body.position.y = 1.4 + Math.sin(t * 3 + st.bobPhase) * 0.18;
    const dx = myPos.x - st.current.x, dz = myPos.z - st.current.z;
    st.mesh.rotation.y = Math.atan2(dz, dx) - Math.PI / 2;
    const sec = Math.ceil(st.data.remaining);
    const txt = `+${fmt(st.data.income)}/сек · ${sec}s`;
    if (st.lastTxt !== txt) {
      redrawLabel(st.mesh.userData.labelSprite, txt);
      st.lastTxt = txt;
    }
    if (st.mesh.userData.particles) {
      for (const p of st.mesh.userData.particles) {
        const ph = p.userData.phase + t * 2.3;
        p.position.y = p.userData.baseY + Math.sin(ph) * 0.4;
        p.material.opacity = 0.6 + Math.sin(ph * 1.7) * 0.4;
      }
    }
  }

  if (my) {
    const pads = my.data.base_pads || [];
    const slots = my.data.base_slots;
    const sel = my.data.destroy_idx;
    for (let i = 0; i < padMeshes.length; i++) {
      const m = padMeshes[i];
      const has = i < slots;
      m.visible = has;
      if (!has) continue;
      m.material = (i === sel) ? padSelectedMat : padEmptyMat;
    }
    const present = new Set();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        present.add(i);
        ensurePadVisual(i, pads[i].value, pads[i].income, pads[i].sparkle);
        const mesh = basePadMeshes.get(i);
        if (mesh) {
          const dxp = myPos.x - mesh.position.x, dzp = myPos.z - mesh.position.z;
          mesh.rotation.y = Math.atan2(dzp, dxp) - Math.PI / 2;
        }
      }
    }
    for (const idx of Array.from(basePadMeshes.keys())) {
      if (!present.has(idx)) removePadVisual(idx);
    }
  }

  rebuildTerrain(serverData.pits);

  {
    const top = serverData.top || [];
    const json = JSON.stringify(top);
    if (json !== lastTopJson) {
      const lines = [{ text: '🏆 ТОП ИГРОКОВ', size: 42, color: '#ffe066' }];
      for (let i = 0; i < 5; i++) {
        const pl = top[i];
        lines.push(pl
          ? { text: `${i + 1}. ${pl.name.slice(0, 12)} — ${fmt(pl.money)}💰`, size: 32 }
          : { text: `${i + 1}. —`, size: 32 });
      }
      topBoard.userData.draw(lines);
      topBoard.userData.texture.needsUpdate = true;
      lastTopJson = json;
    }
  }

  if (my) {
    const px = my.current.x, pz = my.current.z, py = my.current.y;
    const insideBase = px > -1 && px < 32 && pz > -17 && pz < 17;
    const dist = insideBase ? 9 : 20, height = insideBase ? 4 : 7;
    const cosY = Math.cos(camYaw), sinY = Math.sin(camYaw);
    const cosP = Math.cos(camPitch), sinP = Math.sin(camPitch);
    camTarget.set(px - dist * cosY * cosP, py + height + dist * sinP, pz - dist * sinY * cosP);
    camLook.set(px, py + 2.5, pz);
  }
  camera.position.copy(camTarget);
  camera.lookAt(camLook);

  if (my) {
    sun.position.set(my.current.x + 40, 80, 30);
    sun.target.position.set(my.current.x, 0, 0);
    sun.target.updateMatrixWorld();
  }

  renderer.render(scene, camera);
}
frame();