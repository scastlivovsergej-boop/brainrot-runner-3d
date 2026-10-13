// Подключается через `import './input.js'` из game.js
import { G, socket } from './network.js';

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
window.isTouchDevice = isTouchDevice;

let chatFocused = false;
window.__isChatFocused = () => chatFocused;
window.__setChatFocused = (v) => { chatFocused = v; };

// ============================================================
//  ПЕРЕСЧЁТ ДВИЖЕНИЯ
// ============================================================
export function recomputeLocal() {
  let fwd = 0, side = 0;
  if (G.keys.w) fwd += 1;
  if (G.keys.s) fwd -= 1;
  if (G.keys.d) side += 1;
  if (G.keys.a) side -= 1;

  const cosY = Math.cos(G.camYaw), sinY = Math.sin(G.camYaw);
  let dx = fwd * cosY - side * sinY;
  let dz = fwd * sinY + side * cosY;

  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  G.keys.dx = dx;
  G.keys.dz = dz;
}
window.recomputeLocal = recomputeLocal;

export function sendInput(extra) {
  const payload = {
    dx: chatFocused ? 0 : G.keys.dx,
    dz: chatFocused ? 0 : G.keys.dz,
    hold_e: chatFocused ? false : G.holdE,
    hold_d: chatFocused ? false : G.holdD,
    speed_limit: G.speedLimit,
    ...(extra || {})
  };
  socket.emit('input', payload);
}
window.sendInput = sendInput;

function recompute() {
  recomputeLocal();
  sendInput();
}
window.recompute = recompute;

// ============================================================
//  КЛАВИАТУРА
// ============================================================
const K = e => (e && typeof e.key === 'string') ? e.key.toLowerCase() : '';

addEventListener('keydown', e => {
  if (!e || !e.key) return;
  if (e.repeat) return;
  if (chatFocused) return;
  const k = K(e);
  if (!k) return;

  if (['w','ц','arrowup'].includes(k)) G.keys.w = true;
  if (['s','ы','arrowdown'].includes(k)) G.keys.s = true;
  if (['a','ф','arrowleft'].includes(k)) G.keys.a = true;
  if (['d','в','arrowright'].includes(k)) G.keys.d = true;

  if (k === ' ') { e.preventDefault(); sendInput({ jump: true }); return; }
  if (k === 't' || k === 'е') { e.preventDefault(); openChat(); return; }

  if (k === 'e' || k === 'у') {
    G.holdE = true;
    const p = G.serverData.players[G.me];
    if (p && p.shop_open) socket.emit('close_shop');
  }
  if (k === 'd' || k === 'в') G.holdD = true;

  // V — toggle щита
  if (k === 'v' || k === 'м') {
    const p = G.serverData.players[G.me];
    if (p && p.has_shield) {
      socket.emit('input', { toggle_shield: true });
    } else {
      if (window.showToast) window.showToast('Сначала купи щит в магазине', true);
    }
    return;
  }

  recompute();
});

addEventListener('keyup', e => {
  if (!e || !e.key) return;
  if (chatFocused) return;
  const k = K(e);
  if (!k) return;
  if (['w','ц','arrowup'].includes(k)) G.keys.w = false;
  if (['s','ы','arrowdown'].includes(k)) G.keys.s = false;
  if (['a','ф','arrowleft'].includes(k)) G.keys.a = false;
  if (['d','в','arrowright'].includes(k)) G.keys.d = false;
  if (k === 'e' || k === 'у') G.holdE = false;
  if (k === 'd' || k === 'в') G.holdD = false;
  recompute();
});

setInterval(() => sendInput(), 120);

// ============================================================
//  МЫШЬ (только камера и атака — щита тут больше нет)
// ============================================================
const canvas = document.getElementById('game');
let rmbDown = false;

if (canvas) {
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (chatFocused) return;
    if (e.button === 2) {
      rmbDown = true;
      if (canvas.requestPointerLock) canvas.requestPointerLock();
    } else if (e.button === 0) {
      if (window.__tryAttack) window.__tryAttack(e);
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
    const mx = G.invertCamX ? -e.movementX : e.movementX;
    const my = G.invertCamY ? -e.movementY : e.movementY;
    G.camYaw   -= mx * 0.004;
    G.camPitch -= my * 0.004;
    G.camPitch = Math.max(-0.35, Math.min(0.9, G.camPitch));
  });
}

// ============================================================
//  ЧАТ
// ============================================================
function openChat() {
  chatFocused = true;
  const w = document.getElementById('chatInputWrap');
  w.classList.add('active');
  const inp = document.getElementById('chatInput');
  inp.value = '';
  setTimeout(() => inp.focus(), 10);
  G.keys.w = G.keys.a = G.keys.s = G.keys.d = false;
  recompute();
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
//  МОБИЛЬНОЕ УПРАВЛЕНИЕ
// ============================================================
if (isTouchDevice) {
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
    G.keys.w = ny < -0.25;
    G.keys.s = ny > 0.25;
    G.keys.d = nx > 0.25;
    G.keys.a = nx < -0.25;
    recompute();
  }
  function joyEnd(e) {
    const t = Array.from(e.changedTouches).find(x => x.identifier === joyId);
    if (!t) return;
    joyActive = false; joyId = null;
    knob.style.transform = 'translate(-50%,-50%)';
    G.keys.w = G.keys.a = G.keys.s = G.keys.d = false;
    recompute();
  }
  joy.addEventListener('touchstart', joyStart, { passive: true });
  joy.addEventListener('touchmove', joyMove, { passive: true });
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  document.getElementById('mobJump').addEventListener('touchstart', (e) => {
    e.preventDefault();
    sendInput({ jump: true });
  });

  // Щит — toggle
  document.getElementById('mobShield').addEventListener('touchstart', (e) => {
    e.preventDefault();
    const p = G.serverData.players[G.me];
    if (p && p.has_shield) {
      socket.emit('input', { toggle_shield: true });
    } else {
      if (window.showToast) window.showToast('Сначала купи щит в магазине', true);
    }
  });

  document.getElementById('mobAttack').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (window.__attackNearest) window.__attackNearest();
  });

  const mobE = document.getElementById('mobActionE');
  const mobD = document.getElementById('mobActionD');

  mobE.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const p = G.serverData.players[G.me];
    if (p && p.shop_open) { socket.emit('close_shop'); return; }
    G.holdE = true;
    sendInput();
  });
  mobE.addEventListener('touchend', (e) => { e.preventDefault(); G.holdE = false; sendInput(); });
  mobE.addEventListener('touchcancel', () => { G.holdE = false; sendInput(); });

  mobD.addEventListener('touchstart', (e) => { e.preventDefault(); G.holdD = true; sendInput(); });
  mobD.addEventListener('touchend', (e) => { e.preventDefault(); G.holdD = false; sendInput(); });
  mobD.addEventListener('touchcancel', () => { G.holdD = false; sendInput(); });

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
      const mx = G.invertCamX ? -dx : dx;
      const my = G.invertCamY ? -dy : dy;
      G.camYaw   -= mx * 0.006;
      G.camPitch -= my * 0.006;
      G.camPitch = Math.max(-0.35, Math.min(0.9, G.camPitch));
      camLastX = t.clientX;
      camLastY = t.clientY;
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === camTouchId) camTouchId = null;
    }
  });
}