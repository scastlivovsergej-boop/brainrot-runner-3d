import random, threading, time, os, json, hashlib
from flask import Flask, request
from flask_socketio import SocketIO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'public'), static_url_path='')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading',
                    ping_timeout=60, ping_interval=25)

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.after_request
def add_no_cache(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

TICK_RATE = 30
DT = 1.0 / TICK_RATE
DATA_DIR = '/data'
os.makedirs(DATA_DIR, exist_ok=True)
SAVE_FILE = os.path.join(DATA_DIR, 'players.json')
ADMIN_PASSWORD = 'SergGGHH'

WALL_TYPES = [
    {'name': 'super_slow', 'speed': 18, 'color': 0x95a5a6, 'label': '🐢'},
    {'name': 'slow',       'speed': 32, 'color': 0x3498db, 'label': '🚶'},
    {'name': 'normal',     'speed': 48, 'color': 0x2ecc71, 'label': '🏃'},
    {'name': 'fast',       'speed': 70, 'color': 0xf39c12, 'label': '⚡'},
    {'name': 'lightning',  'speed': 95, 'color': 0xe74c3c, 'label': '🌩'},
]

PLAYER_FWD_BASE = 26
PLAYER_STRAFE = 16
LANE_HALF = 15
SAFE_X_MIN = -100
SAFE_X_MAX = 150
SAFE_Z_HALF = 80
ROAD_START_X = SAFE_X_MAX
PIT_LEN = 10
PIT_DEPTH = 4.0
MAX_CARRY = 1
PICK_TIME = 3.0
SHOP_TIME = 2.0
DESTROY_TIME = 5.0
BRAINROT_LIFE = 30.0
BASE_START_SLOTS = 10
BASE_MAX_SLOTS = 50
BASE_ZONE_X = 40
BASE_UPGRADE_COST_BASE = 500
WALL_Z_WIDTH = LANE_HALF * 2
JUMP_DURATION = 0.55
JUMP_HEIGHT = 2.5
WALL_HALF_DEPTH = 1.1
PLAYER_HALF = 0.9
SHOP_X, SHOP_Z = 100, 0
SHOP_RADIUS = 6
PLACE_TIME = 0.8

COST_1_BASE = 100
COST_5_BASE = 500
COST_10_BASE = 1000

PAD_COLS = 6
PAD_XS = [5, 10, 15, 20, 25, 30]
PAD_Z_START = -14
PAD_Z_STEP = 3.5
PAD_RADIUS = 1.9


def pad_pos(idx):
    col = idx % PAD_COLS
    row = idx // PAD_COLS
    return PAD_XS[col], PAD_Z_START + row * PAD_Z_STEP


def hash_pass(p):
    return hashlib.sha256(p.encode()).hexdigest()


def load_accounts():
    if not os.path.exists(SAVE_FILE):
        return {}
    try:
        with open(SAVE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


accounts = load_accounts()


def save_accounts():
    try:
        with open(SAVE_FILE, 'w', encoding='utf-8') as f:
            json.dump(accounts, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print('save err', e)


def persist_player(p):
    if not p.get('account'):
        return
    accounts[p['account']] = {
        'pass_hash': p['pass_hash'],
        'nick': p['name'],
        'money': round(p['money'], 2),
        'speed_bonus': p['speed_bonus'],
        'speed_limit': p.get('speed_limit'),
        'base_slots': p['base_slots'],
        'base_pads': p['base_pads'],
        'base_upgrade_cost': p['base_upgrade_cost'],
        'income_bonus': p.get('income_bonus', 0),
        'is_admin': p.get('is_admin', False),
        'prestige': p.get('prestige', 0),
        'income_multiplier': p.get('income_multiplier', 1.0),
        'cost_1': p.get('cost_1', COST_1_BASE),
        'cost_5': p.get('cost_5', COST_5_BASE),
        'cost_10': p.get('cost_10', COST_10_BASE),
    }


state = {
    'players': {}, 'walls': [], 'brainrots': {}, 'pits': [],
    'next_wall_id': 1, 'next_br_id': 1,
    'wall_timer': 2.0,
}
lock = threading.Lock()


def max_player_x():
    if not state['players']:
        return 200
    return max(200, max(p['x'] for p in state['players'].values()))


def ensure_pits(up_to):
    """Первая яма — сразу после старта дороги, потом через нарастающее расстояние."""
    pits = state['pits']
    if not pits:
        # Первая яма прямо на старте дороги (x = 155)
        pits.append({'x': ROAD_START_X + 5, 'w': PIT_LEN})
    last = pits[-1]['x'] + pits[-1]['w']
    while last < up_to:
        idx = len(pits)
        # промежуток: 12, 22, 32, 42... (+10 за яму)
        gap = 5 + idx * 20 + random.random() * 10
        last += gap
        pits.append({'x': last, 'w': PIT_LEN})
        last += PIT_LEN


def brainrot_value_at(x):
    dx = max(0.0, x - ROAD_START_X)
    base = 15 + dx * 0.5 + (dx ** 1.3) * 0.003
    base *= random.uniform(0.85, 1.15)
    return max(15, int(base))


def brainrot_income(v):
    return round(max(0.5, v / 5.0), 2)


def in_pit(x, margin=0):
    for pt in state['pits']:
        if pt['x'] - margin <= x <= pt['x'] + pt['w'] + margin:
            return True
    return False


def spawn_brainrot():
    mpx = max_player_x()
    for attempt in range(80):
        x = mpx + 30 + random.random() * 250
        if x < ROAD_START_X + 15:
            continue
        if in_pit(x, margin=2):
            continue
        z = (random.random() - 0.5) * (LANE_HALF * 2 - 8)
        too_close = any(abs(br['x'] - x) < 15 for br in state['brainrots'].values())
        if too_close:
            continue
        v = brainrot_value_at(x)
        is_sparkle = random.random() < 0.12
        if is_sparkle:
            v = int(v * 1.5)
        br = {
            'id': state['next_br_id'],
            'x': x, 'z': z,
            'value': v, 'income': brainrot_income(v),
            'sparkle': is_sparkle,
            'expire_at': time.time() + BRAINROT_LIFE,
        }
        state['next_br_id'] += 1
        state['brainrots'][br['id']] = br
        return True
    # fallback
    x = mpx + 100
    z = (random.random() - 0.5) * (LANE_HALF * 2 - 8)
    v = brainrot_value_at(x)
    br = {
        'id': state['next_br_id'],
        'x': x, 'z': z, 'value': v, 'income': brainrot_income(v),
        'sparkle': False, 'expire_at': time.time() + BRAINROT_LIFE,
    }
    state['next_br_id'] += 1
    state['brainrots'][br['id']] = br
    return True


def player_speed(p):
    max_pct = 100 + p['speed_bonus']
    limit = p.get('speed_limit')
    if limit is not None:
        pct = max(0, min(max_pct, int(limit)))
    else:
        pct = max_pct
    return PLAYER_FWD_BASE * (pct / 100.0)


def total_income(p):
    s = 0.0
    for pad in p['base_pads']:
        if pad:
            s += pad['income']
    s += p.get('income_bonus', 0)
    return round(s * p.get('income_multiplier', 1.0), 2)


def new_player(sid, nick):
    return {
        'id': sid, 'name': nick,
        'x': 55.0, 'z': 0.0, 'y': 0.0,
        'state': 'ground',
        'jump_t': 0.0, 'jump_from_y': 0.0,
        'dx': 0, 'dz': 0, 'last_dx': 1,
        'money': 0.0, 'carrying': [],
        'base_slots': BASE_START_SLOTS,
        'base_pads': [None] * BASE_MAX_SLOTS,
        'base_upgrade_cost': BASE_UPGRADE_COST_BASE,
        'speed_bonus': 0,
        'speed_limit': None,
        'income_bonus': 0.0,
        'invuln': 0.0,
        'hold_e': False, 'hold_d': False,
        'pick_t': 0.0, 'pick_target': None,
        'shop_t': 0.0, 'shop_open': False,
        'place_t': 0.0,
        'destroy_idx': -1, 'destroy_t': 0.0,
        'is_admin': False,
        'chat_msg': '', 'chat_until': 0,
        'account': None, 'pass_hash': None,
        'authenticated': False,
        'cost_1': COST_1_BASE,
        'cost_5': COST_5_BASE,
        'cost_10': COST_10_BASE,
        'prestige': 0,
        'income_multiplier': 1.0,
    }


def light_player(p):
    pads = list(p['base_pads'][:p['base_slots']])
    return {
        'id': p['id'], 'name': p['name'],
        'x': round(p['x'], 2), 'z': round(p['z'], 2), 'y': round(p['y'], 2),
        'state': p['state'],
        'money': round(p['money'], 2),
        'income_sec': total_income(p),
        'carry_n': len(p['carrying']),
        'base_slots': p['base_slots'],
        'base_pads': pads,
        'base_upgrade_cost': p['base_upgrade_cost'],
        'last_dx': p['last_dx'],
        'speed_pct': 100 + p['speed_bonus'],
        'speed_pct_active': int(round(100 * player_speed(p) / PLAYER_FWD_BASE)),
        'speed_limit': p.get('speed_limit'),
        'shop_open': p['shop_open'],
        'pick_progress': round(p['pick_t'] / PICK_TIME, 3) if p['pick_target'] else 0,
        'shop_progress': round(p['shop_t'] / SHOP_TIME, 3),
        'near_shop': (p['x'] - SHOP_X) ** 2 + (p['z'] - SHOP_Z) ** 2 < SHOP_RADIUS ** 2,
        'near_brainrot': p['pick_target'] is not None,
        'destroy_idx': p['destroy_idx'],
        'destroy_progress': round(p['destroy_t'] / DESTROY_TIME, 3),
        'place_progress': round(p['place_t'] / PLACE_TIME, 3),
        'chat_msg': p['chat_msg'] if p['chat_until'] > time.time() else '',
        'is_admin': p['is_admin'],
        'prestige': p.get('prestige', 0),
        'income_multiplier': p.get('income_multiplier', 1.0),
        'prestige_threshold': 30 + p.get('prestige', 0) * 10,
        'can_prestige': p['speed_bonus'] >= (30 + p.get('prestige', 0) * 10),
        'cost_1': p.get('cost_1', COST_1_BASE),
        'cost_5': p.get('cost_5', COST_5_BASE),
        'cost_10': p.get('cost_10', COST_10_BASE),
    }


def knockback_player(p):
    old_x, old_z = p['x'], p['z']
    for br in p['carrying']:
        br['x'] = old_x
        br['z'] = old_z
        br['expire_at'] = time.time() + BRAINROT_LIFE
        state['brainrots'][br['id']] = br
    p['carrying'] = []
    p['x'] = ROAD_START_X - 15
    p['z'] = 0
    p['y'] = 0
    p['jump_t'] = 0
    p['invuln'] = 2.0
    p['pick_t'] = 0
    p['pick_target'] = None
    p['destroy_idx'] = -1
    p['destroy_t'] = 0
    socketio.emit('player:hit', {'id': p['id']})


def spawn_wall_pack(base_x):
    n = random.choices([1, 2, 3, 4], weights=[75, 20, 4, 1])[0]
    types = random.sample(WALL_TYPES, n)
    for i, t in enumerate(types):
        w = {
            'id': state['next_wall_id'],
            'x': base_x + i * 35,
            'z': 0, 'w': WALL_Z_WIDTH,
            'name': t['name'], 'speed': t['speed'],
            'color': t['color'], 'label': t['label'],
        }
        state['next_wall_id'] += 1
        state['walls'].append(w)


def pad_at(x, z):
    for i in range(BASE_MAX_SLOTS):
        px, pz = pad_pos(i)
        if (x - px) ** 2 + (z - pz) ** 2 < PAD_RADIUS ** 2:
            return i
    return None


def step(dt):
    ensure_pits(max_player_x() + 1500)
    now = time.time()

    for p in state['players'].values():
        if not p['authenticated']:
            continue

        if p['invuln'] > 0:
            p['invuln'] -= dt
        if p['jump_t'] > 0:
            p['jump_t'] -= dt
            if p['jump_t'] < 0:
                p['jump_t'] = 0

        spd = player_speed(p)
        p['x'] = max(SAFE_X_MIN + 1, p['x'] + spd * p['dx'] * dt)
        zmax = SAFE_Z_HALF if p['x'] < ROAD_START_X else LANE_HALF
        p['z'] = max(-zmax, min(zmax, p['z'] + PLAYER_STRAFE * p['dz'] * dt))

        if p['jump_t'] <= 0:
            if p['state'] == 'ground' and p['x'] > ROAD_START_X and p['invuln'] <= 0:
                if in_pit(p['x']):
                    p['state'] = 'pit'
            elif p['state'] == 'pit':
                if not in_pit(p['x']):
                    p['state'] = 'ground'
                    p['invuln'] = 0.3

        if p['jump_t'] > 0:
            t = 1 - p['jump_t'] / JUMP_DURATION
            p['y'] = p['jump_from_y'] * (1 - t) + 4 * JUMP_HEIGHT * t * (1 - t)
        elif p['state'] == 'pit':
            p['y'] = -PIT_DEPTH + 0.5
        else:
            p['y'] = 0

        if p['dx'] != 0:
            p['last_dx'] = p['dx']

        # --- МАГАЗИН ---
        near_shop = (p['x'] - SHOP_X) ** 2 + (p['z'] - SHOP_Z) ** 2 < SHOP_RADIUS ** 2
        if not near_shop:
            p['shop_open'] = False
            p['shop_t'] = 0
        elif not p['shop_open'] and p['hold_e'] and p['state'] == 'ground':
            p['shop_t'] += dt
            if p['shop_t'] >= SHOP_TIME:
                p['shop_open'] = True
                p['shop_t'] = SHOP_TIME
        elif not p['shop_open']:
            p['shop_t'] = max(0.0, p['shop_t'] - dt * 2)
        # если shop_open уже True — держать не нужно, пока рядом с NPC

        # --- ПОДБОР БРЕЙНРОТА ---
        near_br_id = None
        best_d = 25
        for br_id, br in state['brainrots'].items():
            d = (p['x'] - br['x']) ** 2 + (p['z'] - br['z']) ** 2
            if d < best_d:
                best_d = d
                near_br_id = br_id

        # Сбросить target, если объект уже исчез (забрал другой игрок / истёк)
        if p['pick_target'] is not None and p['pick_target'] not in state['brainrots']:
            p['pick_target'] = None
            p['pick_t'] = 0

        if (near_br_id is not None and p['hold_e'] and p['state'] == 'ground'
                and not near_shop and len(p['carrying']) < MAX_CARRY):
            if p['pick_target'] != near_br_id:
                p['pick_t'] = 0
                p['pick_target'] = near_br_id
            p['pick_t'] += dt
            if p['pick_t'] >= PICK_TIME:
                br = state['brainrots'].pop(near_br_id, None)
                if br:
                    p['carrying'].append(br)
                p['pick_t'] = 0
                p['pick_target'] = None
        else:
            p['pick_t'] = max(0.0, p['pick_t'] - dt * 2)
            if p['pick_t'] <= 0:
                p['pick_target'] = None

        # --- РАЗМЕЩЕНИЕ ---
        if p['carrying'] and p['x'] < 32 and -16 < p['z'] < 16 and p['state'] == 'ground':
            idx = pad_at(p['x'], p['z'])
            if idx is not None and idx < p['base_slots'] and p['base_pads'][idx] is None:
                p['place_t'] += dt
                if p['place_t'] >= PLACE_TIME:
                    br = p['carrying'].pop(0)
                    p['base_pads'][idx] = {
                        'value': br['value'],
                        'income': br['income'],
                        'sparkle': br.get('sparkle', False)
                    }
                    p['place_t'] = 0
                    persist_player(p)
            else:
                p['place_t'] = max(0.0, p['place_t'] - dt * 3)
        else:
            p['place_t'] = max(0.0, p['place_t'] - dt * 3)

        # --- УДАЛЕНИЕ ---
        if p['x'] < 32 and -16 < p['z'] < 16 and p['state'] == 'ground':
            if p['destroy_idx'] >= 0 and p['destroy_idx'] < p['base_slots'] and p['base_pads'][p['destroy_idx']]:
                if p['hold_d']:
                    p['destroy_t'] += dt
                    if p['destroy_t'] >= DESTROY_TIME:
                        p['base_pads'][p['destroy_idx']] = None
                        p['destroy_idx'] = -1
                        p['destroy_t'] = 0
                        persist_player(p)
                else:
                    p['destroy_t'] = max(0.0, p['destroy_t'] - dt * 2)
            else:
                p['destroy_idx'] = -1
                p['destroy_t'] = 0
        else:
            p['destroy_idx'] = -1
            p['destroy_t'] = 0

    # спавн стен
    state['wall_timer'] -= dt
    if state['wall_timer'] <= 0 and max_player_x() > ROAD_START_X + 30:
        mpx = max_player_x()
        if state['walls']:
            front = max(w['x'] for w in state['walls'])
            if front < mpx + 250:
                spawn_wall_pack(mpx + 500)
                state['wall_timer'] = 3.0 + random.random() * 3.0
            else:
                state['wall_timer'] = 0.5
        else:
            spawn_wall_pack(mpx + 500)
            state['wall_timer'] = 3.0 + random.random() * 3.0

    # движение стен
    alive = []
    for w in state['walls']:
        w['x'] -= w['speed'] * dt
        for p in state['players'].values():
            if not p['authenticated']:
                continue
            if p['invuln'] > 0 or p['state'] == 'pit':
                continue
            if p['x'] <= ROAD_START_X:
                continue
            if abs(p['x'] - w['x']) < WALL_HALF_DEPTH + PLAYER_HALF:
                if w['z'] - w['w'] / 2 <= p['z'] <= w['z'] + w['w'] / 2:
                    knockback_player(p)
        if w['x'] > ROAD_START_X - 2:
            alive.append(w)
    state['walls'] = alive

    # доход
    for p in state['players'].values():
        if not p['authenticated']:
            continue
        inc = total_income(p)
        p['money'] += inc * dt

    # истечение брейнротов
    for br_id in list(state['brainrots'].keys()):
        if state['brainrots'][br_id]['expire_at'] <= now:
            del state['brainrots'][br_id]

    while len(state['brainrots']) < 10:
        if not spawn_brainrot():
            break

    state['pits'] = [pt for pt in state['pits'] if pt['x'] + pt['w'] > max_player_x() - 500]

    top = get_top()

    socketio.emit('state', {
        'players': {sid: light_player(p) for sid, p in state['players'].items() if p['authenticated']},
        'walls': state['walls'],
        'brainrots': [
            {'id': b['id'], 'x': round(b['x'], 2), 'z': round(b['z'], 2),
             'value': b['value'], 'income': b['income'], 'sparkle': b.get('sparkle', False),
             'remaining': max(0, round(b['expire_at'] - now, 1))}
            for b in state['brainrots'].values()
        ],
        'pits': state['pits'][:80],
        'top': top,
    })


def get_top(n=5):
    """Топ = онлайн игроки + сохранённые (но не в игре)"""
    online = {}
    for p in state['players'].values():
        if p['authenticated']:
            online[p['name'].lower()] = (p['name'], round(p['money'], 0))
    merged = dict(online)
    for nick, acc in accounts.items():
        key = nick.lower()
        if key in merged:
            continue
        merged[key] = (acc.get('nick', nick), round(acc.get('money', 0), 0))
    sorted_list = sorted(merged.values(), key=lambda x: -x[1])[:n]
    return [{'name': name, 'money': money} for name, money in sorted_list]


def build_state_payload():
    return {
        'players': {sid: light_player(p) for sid, p in state['players'].items() if p['authenticated']},
        'walls': state['walls'],
        'brainrots': [
            {'id': b['id'], 'x': round(b['x'], 2), 'z': round(b['z'], 2),
             'value': b['value'], 'income': b['income'], 'sparkle': b.get('sparkle', False),
             'remaining': max(0, round(b['expire_at'] - time.time(), 1))}
            for b in state['brainrots'].values()
        ],
        'pits': state['pits'][:80],
        'top': get_top(),
    }


def game_loop():
    last_save = time.time()
    while True:
        t0 = time.time()
        with lock:
            try:
                step(DT)
            except Exception:
                import traceback
                traceback.print_exc()
        if time.time() - last_save > 3:
            with lock:
                for p in state['players'].values():
                    if p['authenticated']:
                        persist_player(p)
            save_accounts()
            last_save = time.time()
        time.sleep(max(0, DT - (time.time() - t0)))


ensure_pits(2000)


@socketio.on('connect')
def on_connect():
    sid = request.sid
    with lock:
        p = new_player(sid, 'Гость')
        state['players'][sid] = p
        socketio.emit('init', {
            'you': sid,
            'walls': state['walls'],
            'brainrots': [
                {'id': b['id'], 'x': b['x'], 'z': b['z'], 'value': b['value'],
                 'income': b['income'], 'sparkle': b.get('sparkle', False),
                 'remaining': max(0, round(b['expire_at'] - time.time(), 1))}
                for b in state['brainrots'].values()
            ],
            'pits': state['pits'][:80],
            'shop': {'x': SHOP_X, 'z': SHOP_Z},
            'pad_cols': PAD_COLS, 'pad_xs': PAD_XS,
            'pad_z_start': PAD_Z_START, 'pad_z_step': PAD_Z_STEP,
        }, to=sid)


@socketio.on('check_nick')
def on_check_nick(data):
    nick = str(data.get('nick', ''))[:20].strip()
    if not nick:
        socketio.emit('check_nick_res', {'nick': nick, 'exists': False}, to=request.sid)
        return
    exists = nick in accounts
    socketio.emit('check_nick_res', {'nick': nick, 'exists': exists}, to=request.sid)


@socketio.on('auth')
def on_auth(data):
    sid = request.sid
    nick = str(data.get('nick', ''))[:20].strip()
    pwd = str(data.get('password', ''))
    is_new = bool(data.get('is_new', False))
    if not nick or not pwd:
        socketio.emit('auth_res', {'ok': False, 'err': 'Заполни все поля'}, to=sid)
        return

    with lock:
        p = state['players'].get(sid)
        if not p:
            return

        for other in state['players'].values():
            if other is p:
                continue
            if other['authenticated'] and other['name'].lower() == nick.lower():
                socketio.emit('auth_res', {'ok': False, 'err': 'Ник уже в игре'}, to=sid)
                return

        if nick in accounts and is_new:
            socketio.emit('auth_res', {'ok': False, 'err': 'Ник занят'}, to=sid)
            return
        if nick not in accounts and not is_new:
            socketio.emit('auth_res', {'ok': False, 'err': 'Ник не найден'}, to=sid)
            return

        h = hash_pass(pwd)
        if nick in accounts:
            if accounts[nick]['pass_hash'] != h:
                socketio.emit('auth_res', {'ok': False, 'err': 'Неверный пароль'}, to=sid)
                return
            acc = accounts[nick]
            p['name'] = nick
            p['money'] = float(acc.get('money', 0))
            p['speed_bonus'] = int(acc.get('speed_bonus', 0))
            p['speed_limit'] = acc.get('speed_limit', None)
            p['base_slots'] = int(acc.get('base_slots', BASE_START_SLOTS))
            pads_saved = acc.get('base_pads', [])
            new_pads = [None] * BASE_MAX_SLOTS
            for i in range(min(len(pads_saved), BASE_MAX_SLOTS)):
                new_pads[i] = pads_saved[i]
            p['base_pads'] = new_pads
            p['base_upgrade_cost'] = int(acc.get('base_upgrade_cost', BASE_UPGRADE_COST_BASE))
            p['income_bonus'] = float(acc.get('income_bonus', 0))
            p['is_admin'] = bool(acc.get('is_admin', False))
            p['prestige'] = int(acc.get('prestige', 0))
            p['income_multiplier'] = float(acc.get('income_multiplier', 1.0))
            p['cost_1'] = int(acc.get('cost_1', COST_1_BASE))
            p['cost_5'] = int(acc.get('cost_5', COST_5_BASE))
            p['cost_10'] = int(acc.get('cost_10', COST_10_BASE))
            p['pass_hash'] = h
            p['account'] = nick
            p['authenticated'] = True
        else:
            p['name'] = nick
            p['pass_hash'] = h
            p['account'] = nick
            p['authenticated'] = True
            persist_player(p)
            save_accounts()

        socketio.emit('auth_res', {
            'ok': True,
            'is_admin': p['is_admin'],
        }, to=sid)


@socketio.on('force_open_shop')
def on_force_open_shop():
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return
        near = (p['x'] - SHOP_X) ** 2 + (p['z'] - SHOP_Z) ** 2 < SHOP_RADIUS ** 2
        if near:
            p['shop_open'] = True


@socketio.on('admin_auth')
def on_admin_auth(data):
    sid = request.sid
    pwd = str(data.get('password', ''))
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Не авторизован'}
        if pwd == ADMIN_PASSWORD:
            p['is_admin'] = True
            persist_player(p)
            save_accounts()
            socketio.emit('toast', {'text': 'Доступ разрешён'}, to=sid)
            return {'ok': True}
        socketio.emit('toast', {'text': 'Неверный пароль', 'err': True}, to=sid)
        return {'ok': False, 'err': 'Неверный пароль'}


@socketio.on('admin_get_player')
def on_admin_get_player(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        nick = str(data.get('nick', '')).strip() or p['name']
        for tp in state['players'].values():
            if tp['name'] == nick:
                return {'ok': True, 'data': {
                    'nick': tp['name'],
                    'money': round(tp['money'], 2),
                    'speed_bonus': tp['speed_bonus'],
                    'income_bonus': tp.get('income_bonus', 0),
                    'base_slots': tp['base_slots'],
                    'base_upgrade_cost': tp['base_upgrade_cost'],
                }}
        if nick in accounts:
            acc = accounts[nick]
            return {'ok': True, 'data': {
                'nick': nick,
                'money': acc.get('money', 0),
                'speed_bonus': acc.get('speed_bonus', 0),
                'income_bonus': acc.get('income_bonus', 0),
                'base_slots': acc.get('base_slots', BASE_START_SLOTS),
                'base_upgrade_cost': acc.get('base_upgrade_cost', BASE_UPGRADE_COST_BASE),
            }}
        return {'ok': False, 'err': f'Игрок "{nick}" не найден'}


@socketio.on('admin_cmd')
def on_admin_cmd(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        cmd = data.get('cmd')
        target_nick = str(data.get('nick', '')).strip() or p['name']
        target = None
        for tp in state['players'].values():
            if tp['name'] == target_nick:
                target = tp
                break

        if not target and target_nick in accounts:
            acc = accounts[target_nick]
            target = {
                'name': target_nick,
                'money': float(acc.get('money', 0)),
                'speed_bonus': int(acc.get('speed_bonus', 0)),
                'speed_limit': acc.get('speed_limit'),
                'income_bonus': float(acc.get('income_bonus', 0)),
                'base_slots': int(acc.get('base_slots', BASE_START_SLOTS)),
                'base_pads': acc.get('base_pads', [None] * BASE_MAX_SLOTS),
                'base_upgrade_cost': int(acc.get('base_upgrade_cost', BASE_UPGRADE_COST_BASE)),
                'pass_hash': acc.get('pass_hash'),
                'prestige': int(acc.get('prestige', 0)),
                'income_multiplier': float(acc.get('income_multiplier', 1.0)),
                'cost_1': int(acc.get('cost_1', COST_1_BASE)),
                'cost_5': int(acc.get('cost_5', COST_5_BASE)),
                'cost_10': int(acc.get('cost_10', COST_10_BASE)),
                'account': target_nick,
                'is_admin': acc.get('is_admin', False),
                'authenticated': False,
            }

        if not target:
            resp = {'ok': False, 'err': f'Игрок "{target_nick}" не найден'}
            socketio.emit('toast', {'text': resp['err'], 'err': True}, to=sid)
            return resp
        try:
            if cmd == 'money':
                val = float(data.get('value', 0))
                target['money'] = val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: деньги = {val}'}
            elif cmd == 'income_bonus':
                val = float(data.get('value', 0))
                target['income_bonus'] = val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: доход = {val}/сек'}
            elif cmd == 'speed':
                val = int(data.get('value', 0))
                target['speed_bonus'] = val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: скорость = {100+val}%'}
            elif cmd == 'reset_player':
                # Сброс ВСЕХ данных игрока к начальному состоянию
                target['money'] = 0
                target['speed_bonus'] = 0
                target['speed_limit'] = None
                target['income_bonus'] = 0
                target['base_slots'] = BASE_START_SLOTS
                target['base_pads'] = [None] * BASE_MAX_SLOTS
                target['base_upgrade_cost'] = BASE_UPGRADE_COST_BASE
                target['prestige'] = 0
                target['income_multiplier'] = 1.0
                target['cost_1'] = COST_1_BASE
                target['cost_5'] = COST_5_BASE
                target['cost_10'] = COST_10_BASE
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: ВСЕ данные сброшены'}

            elif cmd == 'set_password':
                new_pwd = str(data.get('value', '')).strip()
                if len(new_pwd) < 3:
                    resp = {'ok': False, 'err': 'Пароль минимум 3 символа'}
                else:
                    target['pass_hash'] = hash_pass(new_pwd)
                    persist_player(target); save_accounts()
                    resp = {'ok': True, 'text': f'{target_nick}: пароль изменён на "{new_pwd}"'}

            elif cmd == 'slots':
                val = int(data.get('value', 10))
                val = max(BASE_START_SLOTS, min(BASE_MAX_SLOTS, val))
                target['base_slots'] = val
                # сбросить пэды вне нового лимита
                for i in range(val, BASE_MAX_SLOTS):
                    target['base_pads'][i] = None
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: пэдов = {val}'}
            elif cmd == 'pad':
                idx = int(data.get('idx', 0))
                val = int(data.get('value', 0))
                inc = float(data.get('income', 0))
                if 0 <= idx < BASE_MAX_SLOTS:
                    if val <= 0 and inc <= 0:
                        target['base_pads'][idx] = None
                        persist_player(target); save_accounts()
                        resp = {'ok': True, 'text': f'Пэд #{idx} очищен'}
                    else:
                        target['base_pads'][idx] = {'value': val, 'income': inc, 'sparkle': False}
                        persist_player(target); save_accounts()
                        resp = {'ok': True, 'text': f'{target_nick}: пэд #{idx} = {val} / +{inc}/сек'}
                else:
                    resp = {'ok': False, 'err': 'Неверный номер пэда'}
            else:
                resp = {'ok': False, 'err': 'Неизвестная команда'}
        except Exception as e:
            resp = {'ok': False, 'err': f'Ошибка: {e}'}
        socketio.emit('toast', {'text': resp.get('text') or resp.get('err'),
                                'err': not resp.get('ok')}, to=sid)
        return resp


@socketio.on('chat')
def on_chat(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return
        text = str(data.get('text', ''))[:200].strip()
        if not text:
            return

        if text.startswith('/admin'):
            socketio.emit('open_admin', {}, to=sid)
            return

        msg = {
            'id': int(time.time() * 1000),
            'nick': p['name'],
            'income': total_income(p),
            'text': text,
            't': time.time(),
        }
        p['chat_msg'] = text
        p['chat_until'] = time.time() + 10
        socketio.emit('chat_msg', msg)


@socketio.on('disconnect')
def on_disconnect():
    with lock:
        p = state['players'].pop(request.sid, None)
        if p:
            persist_player(p)
            save_accounts()


@socketio.on('input')
def on_input(data):
    sid = request.sid
    p = state['players'].get(sid)
    if not p or not p['authenticated']:
        return
    with lock:
        if 'dx' in data:
            p['dx'] = max(-1, min(1, int(data['dx'])))
        if 'dz' in data:
            p['dz'] = max(-1, min(1, int(data['dz'])))
        if 'hold_e' in data:
            p['hold_e'] = bool(data['hold_e'])
        if 'hold_d' in data:
            p['hold_d'] = bool(data['hold_d'])
        if 'speed_limit' in data:
            v = data['speed_limit']
            if v is None:
                p['speed_limit'] = None
            else:
                try:
                    p['speed_limit'] = max(0, min(1000, int(v)))
                except Exception:
                    pass
        if data.get('jump') and p['jump_t'] <= 0:
            p['jump_from_y'] = p['y']
            p['jump_t'] = JUMP_DURATION
            if p['state'] == 'pit':
                p['state'] = 'ground'


@socketio.on('select_destroy')
def on_select_destroy(data):
    with lock:
        p = state['players'].get(request.sid)
        if not p or p['x'] >= 32:
            return
        idx = data.get('index', -1)
        if isinstance(idx, int) and 0 <= idx < p['base_slots'] and p['base_pads'][idx]:
            p['destroy_idx'] = idx
            p['destroy_t'] = 0


@socketio.on('upgrade_base')
def on_upgrade(data=None):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p:
            resp = {'ok': False, 'err': 'Нет игрока'}
        elif p['x'] >= BASE_ZONE_X:
            resp = {'ok': False, 'err': 'Подойди к базе'}
        else:
            cost = p['base_upgrade_cost']
            if p['base_slots'] >= BASE_MAX_SLOTS:
                resp = {'ok': False, 'err': f'Максимум пэдов ({BASE_MAX_SLOTS})'}
            elif p['money'] < cost:
                resp = {'ok': False, 'err': f'Нужно {cost} монет (у тебя {int(p["money"])})'}
            else:
                p['money'] -= cost
                p['base_slots'] += 1
                p['base_upgrade_cost'] = int(cost * 1.8)
                persist_player(p)
                save_accounts()
                resp = {'ok': True, 'text': f'Пэд #{p["base_slots"]} куплен! Осталось до {BASE_MAX_SLOTS}'}
                socketio.emit('state', build_state_payload())
        socketio.emit('toast', {'text': resp.get('text') or resp.get('err'),
                                'err': not resp.get('ok')}, to=sid)
        return resp


@socketio.on('buy_speed')
def on_buy_speed(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['shop_open']:
            resp = {'ok': False, 'err': 'Магазин закрыт'}
        else:
            kind = data.get('kind')
            if kind == 1:
                cost_key, bonus = 'cost_1', 1
            elif kind == 5:
                cost_key, bonus = 'cost_5', 5
            elif kind == 10:
                cost_key, bonus = 'cost_10', 10
            else:
                cost_key, bonus = None, 0
            if cost_key is None:
                resp = {'ok': False, 'err': 'Неизвестно'}
            else:
                cost = p.get(cost_key, COST_1_BASE)
                if p['money'] < cost:
                    resp = {'ok': False, 'err': f'Нужно {cost} монет'}
                else:
                    p['money'] -= cost
                    p['speed_bonus'] += bonus
                    p[cost_key] = int(cost * 3.5)
                    persist_player(p)
                    save_accounts()
                    resp = {'ok': True, 'text': f'+{bonus}% куплено'}
        socketio.emit('toast', {'text': resp.get('text') or resp.get('err'),
                                'err': not resp.get('ok')}, to=sid)
        return resp

@socketio.on('do_prestige')
def on_do_prestige(data=None):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Нет игрока'}
        threshold = 30 + p.get('prestige', 0) * 10
        if p['speed_bonus'] < threshold:
            resp = {'ok': False, 'err': f'Нужна скорость +{threshold}%'}
        else:
            p['prestige'] = p.get('prestige', 0) + 1
            p['income_multiplier'] = 1.0 + 0.5 * p['prestige']
            p['speed_bonus'] = 0
            p['speed_limit'] = None
            p['money'] = 0
            p['base_pads'] = [None] * BASE_MAX_SLOTS
            p['base_slots'] = BASE_START_SLOTS
            p['base_upgrade_cost'] = BASE_UPGRADE_COST_BASE
            p['cost_1'] = COST_1_BASE
            p['cost_5'] = COST_5_BASE
            p['cost_10'] = COST_10_BASE
            persist_player(p)
            save_accounts()
            resp = {'ok': True, 'text': f'⭐ Престиж {p["prestige"]}! Доход x{p["income_multiplier"]}'}
            socketio.emit('state', build_state_payload())
        socketio.emit('toast', {'text': resp.get('text') or resp.get('err'),
                                'err': not resp.get('ok')}, to=sid)
        return resp

@socketio.on('close_shop')
def on_close_shop():
    with lock:
        p = state['players'].get(request.sid)
        if p:
            p['shop_open'] = False
            p['shop_t'] = 0


threading.Thread(target=game_loop, daemon=True).start()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)