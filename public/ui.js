import { G, socket, fmt, showToast } from './network.js';

// ============================================================
//  КНОПКИ
// ============================================================
window.upgradeBase = function() {
  socket.emit('upgrade_base', {}, (resp) => {});
};

function buySpeed(kind) {
  socket.emit('buy_speed', { kind }, (resp) => {});
}

window.admCmd = function(cmd) {
  const nickEl = document.getElementById('admNick');
  const nick = (nickEl && nickEl.value.trim()) ||
    (G.serverData.players[G.me] && G.serverData.players[G.me].name) || '';
  const payload = { cmd, nick };
  if (cmd === 'money') payload.value = parseFloat(document.getElementById('admMoney').value) || 0;
  else if (cmd === 'income_bonus') payload.value = parseFloat(document.getElementById('admInc').value) || 0;
  else if (cmd === 'speed') payload.value = parseInt(document.getElementById('admSpeed').value) || 0;
  else if (cmd === 'prestige') payload.value = parseInt(document.getElementById('admPrestige').value) || 0;
  else if (cmd === 'set_weapon') payload.value = parseInt(document.getElementById('admWeapon').value) || 0;
  else if (cmd === 'set_armor') payload.value = parseInt(document.getElementById('admArmor').value) || 0;
  else if (cmd === 'set_shield') payload.value = parseInt(document.getElementById('admShield').value) || 0;
  else if (cmd === 'slots') payload.value = parseInt(document.getElementById('admSlots').value) || 10;
  else if (cmd === 'set_password') payload.value = document.getElementById('admPass').value.trim();
  else if (cmd === 'reset_player') {
    if (!confirm('Точно СБРОСИТЬ ВСЕ данные игрока?\n\nДеньги, скорость, верити, цены, престиж, оружие, броня, щит — всё обнулится!')) return;
  }
  else if (cmd === 'pad') {
    payload.idx = parseInt(document.getElementById('admPad').value) || 0;
    payload.value = parseInt(document.getElementById('admPadVal').value) || 0;
    payload.income = parseFloat(document.getElementById('admPadInc').value) || 0;
  } else if (cmd === 'pad_clear') {
    payload.cmd = 'pad';
    payload.idx = parseInt(document.getElementById('admPad').value) || 0;
    payload.value = 0; payload.income = 0;
  }
  socket.emit('admin_cmd', payload, (resp) => {});
};

window.adminSubmit = function() {
  const pwd = document.getElementById('adminPass').value;
  socket.emit('admin_auth', { password: pwd }, (resp) => {
    if (resp && resp.ok) {
      G.isAdmin = true;
      document.getElementById('adminAuthBox').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      loadAllNicks();
    } else {
      document.getElementById('adminErr').textContent = (resp && resp.err) || 'Неверно';
    }
  });
};

window.admLoad = function() {
  const nickEl = document.getElementById('admNick');
  const nick = (nickEl && nickEl.value.trim()) ||
    (G.serverData.players[G.me] && G.serverData.players[G.me].name) || '';
  socket.emit('admin_get_player', { nick }, (resp) => {
    if (resp && resp.ok) {
      const d = resp.data;
      document.getElementById('admMoney').value = d.money;
      document.getElementById('admInc').value = d.income_bonus;
      document.getElementById('admSpeed').value = d.speed_bonus;
      document.getElementById('admSlots').value = d.base_slots || 10;
      document.getElementById('admPrestige').value = d.prestige || 0;
      document.getElementById('admWeapon').value = d.weapon_tier || 0;
      document.getElementById('admArmor').value = d.armor_tier || 0;
      document.getElementById('admShield').value = d.has_shield ? 1 : 0;
      showToast('Загружено: ' + d.nick);
    } else {
      showToast((resp && resp.err) || 'Не найден', true);
    }
  });
};

document.getElementById('btnPad').addEventListener('click', window.upgradeBase);

// ============================================================
//  ПРЕСТИЖ
// ============================================================
const prestigeModal = document.getElementById('prestigeModal');
const prestigeInfo = document.getElementById('prestigeInfo');
const prestigeConfirmBtn = document.getElementById('prestigeConfirmBtn');

function openPrestigeModal() {
  const my = G.serverData.players[G.me];
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
    `• оружие и броня: сбросятся<br>` +
    `• щит: сбросится<br>` +
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

// ============================================================
//  МАГАЗИН — вкладки
// ============================================================
let shopTab = 'speed';
document.querySelectorAll('.shop-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.shop-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.shop-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    shopTab = t.dataset.tab;
    const pane = document.getElementById('pane-' + shopTab);
    if (pane) pane.classList.add('active');
  });
});

document.getElementById('shopClose').addEventListener('click', () => {
  socket.emit('close_shop');
});
document.getElementById('shopModal').addEventListener('click', e => {
  if (e.target.id === 'shopModal') socket.emit('close_shop');
});
document.querySelectorAll('.sc-buy-speed').forEach(btn => {
  btn.addEventListener('click', () => buySpeed(parseInt(btn.dataset.kind)));
});

// ============================================================
//  КАРТОЧКИ ОРУЖИЯ / БРОНИ / ЩИТА
// ============================================================
function renderWeapons() {
  const grid = document.getElementById('weaponsGrid');
  if (!grid) return;
  const my = G.serverData.players[G.me];
  if (!my) return;
  const weapons = (window.G && window.G.weapons) || G.weapons || [];
  if (!weapons.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;opacity:0.5;padding:20px">Загрузка...</div>';
    return;
  }
  const myTier = my.weapon_tier || 0;
  grid.innerHTML = weapons.map((w, i) => {
    const owned = i === myTier;
    const weaker = i < myTier;
    const canBuy = i > myTier && my.money >= w.cost;
    let btnLabel = 'Купить';
    if (owned) btnLabel = '✅ Надето';
    else if (weaker) btnLabel = '— Хуже';
    else if (my.money < w.cost) btnLabel = 'Мало 💰';
    const cls = 'weapon-card' + (owned ? ' owned' : '') + (weaker ? ' weaker' : '');
    return `<div class="${cls}">
      <div class="wc-emoji">${w.emoji}</div>
      <div class="wc-name">${w.name}</div>
      <div class="wc-stat">Урон: ${w.damage}</div>
      <div class="wc-price">${w.cost === 0 ? '—' : fmt(w.cost) + '💰'}</div>
      <button class="sc-btn wc-buy" data-tier="${i}" ${(canBuy && !owned && !weaker) ? '' : 'disabled'}>${btnLabel}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.wc-buy').forEach(btn => {
    btn.addEventListener('click', () => {
      const tier = parseInt(btn.dataset.tier);
      socket.emit('buy_weapon', { tier }, (resp) => {
        if (resp && !resp.ok) showToast(resp.err, true);
      });
    });
  });
}

function renderArmors() {
  const grid = document.getElementById('armorsGrid');
  if (!grid) return;
  const my = G.serverData.players[G.me];
  if (!my) return;
  const armors = (window.G && window.G.armors) || G.armors || [];
  if (!armors.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;opacity:0.5;padding:20px">Загрузка...</div>';
    return;
  }
  const myTier = my.armor_tier || 0;
  grid.innerHTML = armors.map((a, i) => {
    const owned = i === myTier;
    const weaker = i < myTier;
    const canBuy = i > myTier && my.money >= a.cost;
    let btnLabel = 'Купить';
    if (owned) btnLabel = '✅ Надето';
    else if (weaker) btnLabel = '— Хуже';
    else if (my.money < a.cost) btnLabel = 'Мало 💰';
    const cls = 'armor-card' + (owned ? ' owned' : '') + (weaker ? ' weaker' : '');
    return `<div class="${cls}">
      <div class="wc-emoji">${a.emoji}</div>
      <div class="wc-name">${a.name}</div>
      <div class="wc-stat">HP: ${a.hp}</div>
      <div class="wc-price">${a.cost === 0 ? '—' : fmt(a.cost) + '💰'}</div>
      <button class="sc-btn wc-buy" data-tier="${i}" ${(canBuy && !owned && !weaker) ? '' : 'disabled'}>${btnLabel}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.wc-buy').forEach(btn => {
    btn.addEventListener('click', () => {
      const tier = parseInt(btn.dataset.tier);
      socket.emit('buy_armor', { tier }, (resp) => {
        if (resp && !resp.ok) showToast(resp.err, true);
      });
    });
  });
}

function renderShield() {
  const box = document.getElementById('shieldBox');
  if (!box) return;
  const my = G.serverData.players[G.me];
  if (!my) return;
  const has = !!my.has_shield;
  if (has) {
    box.innerHTML = `<div class="shield-card owned">
      <div class="wc-emoji">🛡️</div>
      <div>
        <div class="wc-name">Щит</div>
        <div class="wc-stat">V — вкл/выкл (медленнее, но −90% урона)</div>
      </div>
    </div>`;
  } else {
    box.innerHTML = `<div class="shield-card">
      <div class="wc-emoji">🛡️</div>
      <div style="flex:1">
        <div class="wc-name">Щит</div>
        <div class="wc-stat">−90% урона, но −50% скорости</div>
        <div class="wc-price">${fmt(1000000)}💰</div>
      </div>
      <button class="sc-btn wc-buy" id="buyShieldBtn">Купить</button>
    </div>`;
    const btn = document.getElementById('buyShieldBtn');
    if (btn) btn.addEventListener('click', () => {
      socket.emit('buy_shield', {}, (resp) => {
        if (resp && !resp.ok) showToast(resp.err, true);
      });
    });
  }
}

// ============================================================
//  АВТОРИЗАЦИЯ
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

// ============================================================
//  НАСТРОЙКИ
// ============================================================
document.getElementById('settingsClose').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('active');
});
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.add('active');
});

document.getElementById('setChatOn').checked = G.chatShow;
document.getElementById('setChatHead').checked = G.chatHead;
document.getElementById('setDur').value = G.chatDur;
document.getElementById('setDurVal').textContent = G.chatDur;
document.getElementById('setInvX').checked = G.invertCamX;
document.getElementById('setInvY').checked = G.invertCamY;

document.getElementById('setChatOn').addEventListener('change', e => {
  G.chatShow = e.target.checked;
  if (!G.chatShow) document.getElementById('chatLog').innerHTML = '';
  try { localStorage.setItem('br_chatShow', G.chatShow); } catch(_){}
});
document.getElementById('setDur').addEventListener('input', e => {
  G.chatDur = parseInt(e.target.value);
  document.getElementById('setDurVal').textContent = G.chatDur;
  try { localStorage.setItem('br_chatDur', G.chatDur); } catch(_){}
});
document.getElementById('setChatHead').addEventListener('change', e => {
  G.chatHead = e.target.checked;
  try { localStorage.setItem('br_chatHead', G.chatHead); } catch(_){}
});
document.getElementById('setInvX').addEventListener('change', e => {
  G.invertCamX = e.target.checked;
  try { localStorage.setItem('br_invX', G.invertCamX); } catch(_){}
  showToast('Инверсия X: ' + (G.invertCamX ? 'ВКЛ' : 'ВЫКЛ'));
});
document.getElementById('setInvY').addEventListener('change', e => {
  G.invertCamY = e.target.checked;
  try { localStorage.setItem('br_invY', G.invertCamY); } catch(_){}
  showToast('Инверсия Y: ' + (G.invertCamY ? 'ВКЛ' : 'ВЫКЛ'));
});

// ============================================================
//  АВТОДОПОЛНЕНИЕ НИКОВ
// ============================================================
const admNickInput = document.getElementById('admNick');
const admNickDropdown = document.getElementById('admNickDropdown');
let nickSelectedIdx = -1;

function renderNickDropdown(filter) {
  const all = G.serverData.all_nicks || [];
  const f = (filter || '').toLowerCase();
  const list = all.filter(n => n.toLowerCase().includes(f)).slice(0, 20);
  if (!list.length) {
    admNickDropdown.classList.remove('active');
    return;
  }
  admNickDropdown.innerHTML = list.map(n =>
    `<div class="nick-option" data-nick="${n}">${n}</div>`
  ).join('');
  admNickDropdown.querySelectorAll('.nick-option').forEach(el => {
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      admNickInput.value = el.dataset.nick;
      admNickDropdown.classList.remove('active');
    });
  });
  admNickDropdown.classList.add('active');
  nickSelectedIdx = -1;
}

admNickInput.addEventListener('focus', () => renderNickDropdown(admNickInput.value));
admNickInput.addEventListener('input', () => renderNickDropdown(admNickInput.value));
admNickInput.addEventListener('blur', () => {
  setTimeout(() => admNickDropdown.classList.remove('active'), 150);
});
admNickInput.addEventListener('keydown', (e) => {
  const opts = admNickDropdown.querySelectorAll('.nick-option');
  if (e.key === 'Tab' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (!admNickDropdown.classList.contains('active')) renderNickDropdown(admNickInput.value);
    if (opts.length) {
      nickSelectedIdx = (nickSelectedIdx + 1) % opts.length;
      opts.forEach((el, i) => el.classList.toggle('selected', i === nickSelectedIdx));
      admNickInput.value = opts[nickSelectedIdx].dataset.nick;
    }
  } else if (e.key === 'Enter') {
    if (nickSelectedIdx >= 0 && opts[nickSelectedIdx]) {
      admNickInput.value = opts[nickSelectedIdx].dataset.nick;
      admNickDropdown.classList.remove('active');
      nickSelectedIdx = -1;
    }
  } else if (e.key === 'Escape') {
    admNickDropdown.classList.remove('active');
    nickSelectedIdx = -1;
  }
});

export function loadAllNicks() {
  socket.emit('admin_list_nicks', {}, (resp) => {
    if (resp && resp.ok) G.serverData.all_nicks = resp.nicks || [];
  });
}
window.loadAllNicks = loadAllNicks;

// ============================================================
//  ПИНГ
// ============================================================
function updatePingDisplay(ms) {
  const el = document.getElementById('pingChip');
  if (!el) return;
  el.textContent = `📶 ${ms} ms`;
  el.classList.remove('warn', 'bad');
  if (ms > 150) el.classList.add('warn');
  if (ms > 300) el.classList.add('bad');
}
setInterval(() => {
  const t0 = performance.now();
  socket.emit('ping_check', {}, () => {
    updatePingDisplay(Math.round(performance.now() - t0));
  });
}, 2500);

// ============================================================
//  HUD ОБНОВЛЕНИЕ
// ============================================================
setInterval(() => {
  const my = G.serverData.players[G.me];
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
    `<span class="hint">WASD · SPACE · T — чат · ЛКМ — атака · V — щит</span>`;
  document.getElementById('speedChip').innerHTML =
    `⚡ ${my.speed_pct_active || my.speed_pct}% / ${my.speed_pct}%`;

  const weapons = (window.G && window.G.weapons) || [];
  const wName = weapons[my.weapon_tier] ? weapons[my.weapon_tier].name : '—';
  const wEmoji = weapons[my.weapon_tier] ? weapons[my.weapon_tier].emoji : '⚔️';
  const chip = document.getElementById('weaponChip');
  if (chip) {
    if (my.shielded) {
      chip.innerHTML = '🛡️ Щит активен';
    } else {
      chip.innerHTML = `${wEmoji} ${wName}`;
    }
  }

  const topList = G.serverData.top || [];
  document.getElementById('board').innerHTML =
    '<b>🏆 Топ</b><br>' +
    topList.slice(0, 8).map((pl, i) => {
      const medal = ['🥇','🥈','🥉'][i] || (i+1) + '.';
      const isMe = pl.name === my.name;
      return `${medal} ${isMe ? '<b>' : ''}${pl.name}${isMe ? '</b>' : ''} — ${fmt(pl.money)}💰`;
    }).join('<br>');

  const btnPad = document.getElementById('btnPad');
  if (btnPad) {
    const full = my.base_slots >= 50;
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

  if (!window.isTouchDevice) {
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

  // Магазин
  const shopModal = document.getElementById('shopModal');
  if (my.shop_open) {
    shopModal.classList.add('active');
    document.getElementById('shopSpeedVal').textContent = my.speed_pct + '%';
    document.getElementById('scp1').textContent = fmt(my.cost_1) + '💰';
    document.getElementById('scp5').textContent = fmt(my.cost_5) + '💰';
    document.getElementById('scp10').textContent = fmt(my.cost_10) + '💰';
    document.querySelectorAll('.sc-buy-speed').forEach(btn => {
      const kind = parseInt(btn.dataset.kind);
      const cost = kind === 1 ? my.cost_1 : kind === 5 ? my.cost_5 : my.cost_10;
      btn.disabled = my.money < cost;
    });
    renderWeapons();
    renderArmors();
    renderShield();
  } else {
    shopModal.classList.remove('active');
  }
}, 100);

// ============================================================
//  МОБИЛЬНЫЕ КНОПКИ E/D
// ============================================================
if (window.isTouchDevice) {
  const mobE = document.getElementById('mobActionE');
  const mobD = document.getElementById('mobActionD');
  const mobEIcon = document.getElementById('mobActionEIcon');
  const mobELabel = document.getElementById('mobActionELabel');
  const mobDIcon = document.getElementById('mobActionDIcon');
  const mobDLabel = document.getElementById('mobActionDLabel');
  const mobProgressE = document.getElementById('mobProgressE').firstElementChild;
  const mobProgressD = document.getElementById('mobProgressD').firstElementChild;

  setInterval(() => {
    const my = G.serverData.players[G.me];
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
//  SPEED SWITCH
// ============================================================
const ssWrap = document.getElementById('speedSwitch');
const ssNormal = document.getElementById('ssNormal');
const ssCustom = document.getElementById('ssCustom');
const ssSliderWrap = document.getElementById('ssSliderWrap');
const ssSlider = document.getElementById('ssSlider');
const ssSliderVal = document.getElementById('ssSliderVal');

function refreshSpeedSwitch() {
  const p = G.serverData.players[G.me];
  if (!p) return;
  const maxPct = p.speed_pct || 100;

  if (maxPct < 150) {
    ssWrap.classList.remove('active');
    if (G.speedLimit !== null) {
      G.speedLimit = null;
      window.sendInput && window.sendInput();
    }
    return;
  }

  ssWrap.classList.add('active');
  ssSlider.max = maxPct;

  if (G.speedLimit === null) {
    ssNormal.classList.remove('on');
    ssCustom.classList.remove('on');
    ssSliderWrap.classList.remove('active');
    ssSliderVal.textContent = 'MAX ' + maxPct + '%';
  } else if (G.speedLimit === 100) {
    ssNormal.classList.add('on');
    ssCustom.classList.remove('on');
    ssSliderWrap.classList.remove('active');
    ssSliderVal.textContent = '100%';
  } else {
    ssNormal.classList.remove('on');
    ssCustom.classList.add('on');
    ssSliderWrap.classList.add('active');
    if (parseInt(ssSlider.value) !== G.speedLimit) ssSlider.value = G.speedLimit;
    ssSliderVal.textContent = G.speedLimit + '%';
  }
}
ssNormal.addEventListener('click', () => { G.speedLimit = 100; window.sendInput && window.sendInput(); refreshSpeedSwitch(); });
ssCustom.addEventListener('click', () => {
  const maxPct = (G.serverData.players[G.me] && G.serverData.players[G.me].speed_pct) || 100;
  if (G.speedLimit === null || G.speedLimit === 100) G.speedLimit = maxPct;
  window.sendInput && window.sendInput();
  refreshSpeedSwitch();
});
ssSlider.addEventListener('input', () => {
  G.speedLimit = parseInt(ssSlider.value);
  ssSliderVal.textContent = G.speedLimit + '%';
  window.sendInput && window.sendInput();
});
setInterval(refreshSpeedSwitch, 200);

// ============================================================
//  ПОКАЗЫВАЕМ ОКНО АВТОРИЗАЦИИ ТОЛЬКО ЕСЛИ JS ДОЖИЛ ДО СЮДА
//  (если что-то упало — будет чистый экран без блюра,
//   и в F12 сразу будет видно причину)
// ============================================================
{
  const authModal = document.getElementById('authModal');
  if (authModal && !authModal.classList.contains('active')) {
    authModal.classList.add('active');
  }
}