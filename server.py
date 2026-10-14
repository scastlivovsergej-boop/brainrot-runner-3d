from gevent import monkey
monkey.patch_all()

from psycogreen.gevent import patch_psycopg
patch_psycopg()

import random, threading, time, os, json, hashlib, math
import psycopg2
from psycopg2.extras import Json
from flask import Flask, request
from flask_socketio import SocketIO

DB_URL = 'postgresql://postgres.butcgsmwqyviesojrclq:qJ4iu4Bqwb6AkaFc@aws-1-eu-central-1.pooler.supabase.com:5432/postgres'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE_DIR, 'public'), static_url_path='')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='gevent',
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

WEAPONS = [
    {'name': 'Кулак',    'emoji': '🥊', 'damage': 0,  'cost': 0},
    {'name': 'Бита',     'emoji': '🏏', 'damage': 2,  'cost': 50_000},
    {'name': 'Нож',      'emoji': '🔪', 'damage': 3,  'cost': 250_000},
    {'name': 'Меч',      'emoji': '🗡️', 'damage': 5,  'cost': 1_250_000},
    {'name': 'Пистолет', 'emoji': '🔫', 'damage': 8,  'cost': 5_000_000},
    {'name': 'РПГ',      'emoji': '💥', 'damage': 20, 'cost': 50_000_000},
]

ARMORS = [
    {'name': 'Без брони', 'emoji': '👕', 'hp': 3,  'cost': 0},
    {'name': 'Лёгкая',    'emoji': '🦺', 'hp': 6,  'cost': 100_000},
    {'name': 'Средняя',   'emoji': '🛡️', 'hp': 12, 'cost': 500_000},
    {'name': 'Тяжёлая',   'emoji': '🛡️🛡️', 'hp': 20, 'cost': 2_500_000},
    {'name': 'Алмазная',  'emoji': '💎', 'hp': 40, 'cost': 15_000_000},
]

SHIELD_COST = 1_000_000

RARITIES = [
    {'key': 'common',    'name': 'Обычный',     'weight': 70, 'mult': 1.0,  'sparkle': False, 'color': '#a0a0a0'},
    {'key': 'rare',      'name': 'Редкий',      'weight': 20, 'mult': 2.5,  'sparkle': False, 'color': '#3498db'},
    {'key': 'epic',      'name': 'Эпический',   'weight': 8,  'mult': 5.0,  'sparkle': True,  'color': '#9b59b6'},
    {'key': 'legendary', 'name': 'Легендарный', 'weight': 2,  'mult': 15.0, 'sparkle': True,  'color': '#f39c12'},
]

ROULETTE_COST = 10_000

ATTACK_RADIUS = 5.0
ATTACK_CD = 0.3
STUN_DURATION = 2.0
INVULN_AFTER_STUN = 5.0
DAMAGE_RESET_TIME = 30.0
SHIELD_SPEED_MULT = 0.5
SHIELD_DAMAGE_MULT = 0.1

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

PLAYER_BR_CAP = 40
PLAYER_BR_RANGE = (50, 1500)

DEFAULT_WALL_SETTINGS = {
    'limit': 70,
    'interval_min': 2.0,
    'interval_range': 2.0,
    'pack_max': 5,
    'pack_weights': [40, 30, 15, 10, 5],
    'start_delay': 1.5,
}


def pad_pos(idx):
    col = idx % PAD_COLS
    row = idx // PAD_COLS
    return PAD_XS[col], PAD_Z_START + row * PAD_Z_STEP


def hash_pass(p):
    return hashlib.sha256(p.encode()).hexdigest()


def db_conn():
    return psycopg2.connect(DB_URL, connect_timeout=10)


def init_db():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS accounts (
                        nick TEXT PRIMARY KEY,
                        data JSONB NOT NULL
                    )
                ''')
            conn.commit()
        print('[DB] Table ready')
    except Exception as e:
        print('[DB] init error:', e)


def load_accounts():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT nick, data FROM accounts')
                rows = cur.fetchall()
        result = {}
        for nick, data in rows:
            result[nick] = data
        print(f'[DB] Loaded {len(result)} accounts')
        return result
    except Exception as e:
        print('[DB] load error:', e)
        if os.path.exists(SAVE_FILE):
            try:
                with open(SAVE_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}


init_db()
accounts = load_accounts()

_last_save_err_log = 0


def save_accounts():
    global _last_save_err_log
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                for nick, data in accounts.items():
                    cur.execute('''
                        INSERT INTO accounts (nick, data) VALUES (%s, %s)
                        ON CONFLICT (nick) DO UPDATE SET data = EXCLUDED.data
                    ''', (nick, Json(data)))
            conn.commit()
        _last_save_err_log = 0
    except Exception as e:
        if time.time() - _last_save_err_log > 30:
            print('[DB] save error:', e)
            _last_save_err_log = time.time()
        try:
            with open(SAVE_FILE, 'w', encoding='utf-8') as f:
                json.dump(accounts, f, ensure_ascii=False, indent=2)
        except Exception as e2:
            print('json fallback err', e2)


def persist_player(p):
    if not p.get('account'):
        return
    if p.get('delete_pending'):
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
        'weapon_tier': p.get('weapon_tier', 0),
        'armor_tier': p.get('armor_tier', 0),
        'has_shield': p.get('has_shield', False),
    }


state = {
    'players': {}, 'walls': [], 'brainrots': {}, 'pits': [],
    'next_wall_id': 1, 'next_br_id': 1,
    'wall_timer': 2.0,
    'br_check_timer': 0.0,
    'pvp_enabled': True,
    'banned': set(),
    'wall_settings': dict(DEFAULT_WALL_SETTINGS),
}
lock = threading.Lock()


BANNED_FILE = os.path.join(DATA_DIR, 'banned.json')


def load_banned():
    try:
        if os.path.exists(BANNED_FILE):
            with open(BANNED_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
    except Exception as e:
        print('[BAN] load error:', e)
    return set()


def save_banned():
    try:
        with open(BANNED_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted(state['banned']), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print('[BAN] save error:', e)


WALL_SETTINGS_FILE = os.path.join(DATA_DIR, 'wall_settings.json')


def load_wall_settings():
    try:
        if os.path.exists(WALL_SETTINGS_FILE):
            with open(WALL_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            merged = dict(DEFAULT_WALL_SETTINGS)
            merged.update(data)
            return merged
    except Exception as e:
        print('[WALLS] load error:', e)
    return dict(DEFAULT_WALL_SETTINGS)


def save_wall_settings():
    try:
        with open(WALL_SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(state['wall_settings'], f, ensure_ascii=False, indent=2)
    except Exception as e:
        print('[WALLS] save error:', e)


state['banned'] = load_banned()
state['wall_settings'] = load_wall_settings()
print(f"[WALLS] Loaded settings: {state['wall_settings']}")


def max_player_x():
    if not state['players']:
        return 200
    return max(200, max(p['x'] for p in state['players'].values()))


def ensure_pits(up_to):
    pits = state['pits']
    if not pits:
        pits.append({'x': ROAD_START_X + 5, 'w': PIT_LEN})
    last = pits[-1]['x'] + pits[-1]['w']
    while last < up_to:
        dist = max(0.0, last - ROAD_START_X)
        gap = 5 + dist * 0.1 + random.random() * 15
        last += gap
        pits.append({'x': last, 'w': PIT_LEN})
        last += PIT_LEN


def reset_pits():
    state['pits'] = []
    ensure_pits(2000)


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


def roll_rarity():
    keys = [r['weight'] for r in RARITIES]
    return random.choices(RARITIES, weights=keys)[0]


def spawn_brainrot_near(x_center, force_rarity=None):
    for attempt in range(30):
        x = x_center + PLAYER_BR_RANGE[0] + random.random() * (PLAYER_BR_RANGE[1] - PLAYER_BR_RANGE[0])
        if x < ROAD_START_X + 15:
            continue
        if in_pit(x, margin=2):
            continue
        z = (random.random() - 0.5) * (LANE_HALF * 2 - 8)
        too_close = any(abs(br['x'] - x) < 20 for br in state['brainrots'].values())
        if too_close:
            continue
        base_v = brainrot_value_at(x)
        rarity = force_rarity or roll_rarity()
        v = int(base_v * rarity['mult'])
        br = {
            'id': state['next_br_id'],
            'x': x, 'z': z,
            'value': v, 'income': brainrot_income(v),
            'sparkle': rarity['sparkle'],
            'rarity': rarity['key'],
            'expire_at': time.time() + BRAINROT_LIFE,
        }
        state['next_br_id'] += 1
        state['brainrots'][br['id']] = br
        return True
    return False


def player_speed(p):
    max_pct = 100 + p['speed_bonus']
    limit = p.get('speed_limit')
    if limit is not None:
        pct = max(0, min(max_pct, int(limit)))
    else:
        pct = max_pct
    base = PLAYER_FWD_BASE * (pct / 100.0)
    if p.get('shield_active'):
        base *= SHIELD_SPEED_MULT
    return base


def total_income(p):
    s = 0.0
    for pad in p['base_pads']:
        if pad:
            s += pad['income']
    s += p.get('income_bonus', 0)
    return round(s * p.get('income_multiplier', 1.0), 2)


def get_hp_max(p):
    tier = max(0, min(len(ARMORS) - 1, p.get('armor_tier', 0)))
    return ARMORS[tier]['hp']


def new_player(sid, nick):
    return {
        'id': sid, 'name': nick,
        'x': 55.0, 'z': 0.0, 'y': 0.0,
        'state': 'ground',
        'jump_t': 0.0, 'jump_from_y': 0.0,
        'dx': 0.0, 'dz': 0.0,
        'facing': 0.0,
        'last_dx': 1,
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
        'wall_timer': state['wall_settings'].get('start_delay', 1.5),
        'weapon_tier': 0,
        'armor_tier': 0,
        'has_shield': False,
        'shield_active': False,
        'damage_accum': 0.0,
        'last_dmg_time': 0.0,
        'stun_until': 0.0,
        'invuln_until': 0.0,
        'attack_cd': 0.0,
    }


def light_player(p):
    pads = list(p['base_pads'][:p['base_slots']])
    now = time.time()
    hp_max = get_hp_max(p)
    hp_cur = max(0, hp_max - p.get('damage_accum', 0))
    carry_info = None
    if p.get('carrying'):
        br = p['carrying'][0]
        carry_info = {
            'value': br['value'],
            'income': br['income'],
            'sparkle': br.get('sparkle', False),
            'rarity': br.get('rarity', 'common'),
        }
    return {
        'id': p['id'], 'name': p['name'],
        'x': round(p['x'], 2), 'z': round(p['z'], 2), 'y': round(p['y'], 2),
        'facing': round(p.get('facing', 0.0), 3),
        'state': p['state'],
        'money': round(p['money'], 2),
        'income_sec': total_income(p),
        'carry_n': len(p['carrying']),
        'carry_info': carry_info,
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
        'weapon_tier': p.get('weapon_tier', 0),
        'armor_tier': p.get('armor_tier', 0),
        'has_shield': bool(p.get('has_shield', False)),
        'hp_max': hp_max,
        'hp_cur': round(hp_cur, 1),
        'damage_accum': round(p.get('damage_accum', 0), 1),
        'stunned': now < p.get('stun_until', 0),
        'shielded': bool(p.get('shield_active')),
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


def spawn_wall_pack_near(x_center, ws=None):
    if ws is None:
        ws = state['wall_settings']
    max_pack = max(1, int(ws['pack_max']))
    weights = list(ws['pack_weights'])[:max_pack]
    while len(weights) < max_pack:
        weights.append(1)
    n = random.choices(range(1, max_pack + 1), weights=weights)[0]
    types = random.sample(WALL_TYPES, min(n, len(WALL_TYPES)))
    base_x = x_center + 400
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


def stun_player(t):
    now = time.time()
    t['stun_until'] = now + STUN_DURATION
    t['invuln_until'] = now + INVULN_AFTER_STUN
    t['damage_accum'] = 0
    for br in t['carrying']:
        br['x'] = t['x']
        br['z'] = t['z']
        br['expire_at'] = time.time() + BRAINROT_LIFE
        state['brainrots'][br['id']] = br
    t['carrying'] = []
    socketio.emit('player:stunned', {'id': t['id']})


def step(dt):
    ensure_pits(max_player_x() + 1500)
    now = time.time()

    for p in state['players'].values():
        if not p['authenticated']:
            continue

        if p['invuln'] > 0:
            p['invuln'] -= dt
        if p['attack_cd'] > 0:
            p['attack_cd'] -= dt
        if p['jump_t'] > 0:
            p['jump_t'] -= dt
            if p['jump_t'] < 0:
                p['jump_t'] = 0

        if p['damage_accum'] > 0 and now - p['last_dmg_time'] > DAMAGE_RESET_TIME:
            p['damage_accum'] = 0

        is_stunned = now < p['stun_until']
        spd = player_speed(p) if not is_stunned else 0
        p['x'] = max(SAFE_X_MIN + 1, p['x'] + spd * p['dx'] * dt)
        zmax = SAFE_Z_HALF if p['x'] < ROAD_START_X else LANE_HALF
        p['z'] = max(-zmax, min(zmax, p['z'] + PLAYER_STRAFE * p['dz'] * dt))

        if p['dx'] != 0 or p['dz'] != 0:
            p['facing'] = math.atan2(p['dz'], p['dx'])

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

        near_br_id = None
        best_d = 25
        for br_id, br in state['brainrots'].items():
            d = (p['x'] - br['x']) ** 2 + (p['z'] - br['z']) ** 2
            if d < best_d:
                best_d = d
                near_br_id = br_id

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

        if p['carrying'] and p['x'] < 32 and -16 < p['z'] < 16 and p['state'] == 'ground':
            idx = pad_at(p['x'], p['z'])
            if idx is not None and idx < p['base_slots'] and p['base_pads'][idx] is None:
                p['place_t'] += dt
                if p['place_t'] >= PLACE_TIME:
                    br = p['carrying'].pop(0)
                    p['base_pads'][idx] = {
                        'value': br['value'],
                        'income': br['income'],
                        'sparkle': br.get('sparkle', False),
                        'rarity': br.get('rarity', 'common'),
                    }
                    p['place_t'] = 0
                    persist_player(p)
            else:
                p['place_t'] = max(0.0, p['place_t'] - dt * 3)
        else:
            p['place_t'] = max(0.0, p['place_t'] - dt * 3)

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

    ws = state['wall_settings']
    for p in state['players'].values():
        if not p['authenticated']:
            continue
        p['wall_timer'] -= dt
        if p['wall_timer'] <= 0:
            if len(state['walls']) < ws['limit']:
                spawn_wall_pack_near(p['x'], ws)
                p['wall_timer'] = ws['interval_min'] + random.random() * ws['interval_range']
            else:
                p['wall_timer'] = 0.8

    alive = []
    for w in state['walls']:
        w['x'] -= w['speed'] * dt
        for p in state['players'].values():
            if not p['authenticated']:
                continue
            if p['invuln'] > 0 or p['state'] == 'pit':
                continue
            if now < p['stun_until']:
                continue
            if p['x'] <= ROAD_START_X:
                continue
            if abs(p['x'] - w['x']) < WALL_HALF_DEPTH + PLAYER_HALF:
                if w['z'] - w['w'] / 2 <= p['z'] <= w['z'] + w['w'] / 2:
                    knockback_player(p)
        if w['x'] > ROAD_START_X - 2:
            alive.append(w)
    state['walls'] = alive

    for p in state['players'].values():
        if not p['authenticated']:
            continue
        inc = total_income(p)
        p['money'] += inc * dt

    for br_id in list(state['brainrots'].keys()):
        if state['brainrots'][br_id]['expire_at'] <= now:
            del state['brainrots'][br_id]

    state['br_check_timer'] -= dt
    if state['br_check_timer'] <= 0:
        state['br_check_timer'] = 1.0
        for p in state['players'].values():
            if not p['authenticated'] or p['x'] < ROAD_START_X - 50:
                continue
            xlo = p['x'] + PLAYER_BR_RANGE[0]
            xhi = p['x'] + PLAYER_BR_RANGE[1]
            cnt = sum(1 for br in state['brainrots'].values() if xlo < br['x'] < xhi)
            need = PLAYER_BR_CAP - cnt
            for _ in range(min(need, 5)):
                if not spawn_brainrot_near(p['x']):
                    break

    mpx = max_player_x()
    state['pits'] = [pt for pt in state['pits']
                     if pt['x'] < ROAD_START_X + 3000
                     or pt['x'] + pt['w'] > mpx - 500]

    top = get_top()

    socketio.emit('state', {
        'players': {sid: light_player(p) for sid, p in state['players'].items() if p['authenticated']},
        'walls': state['walls'],
        'brainrots': [
            {'id': b['id'], 'x': round(b['x'], 2), 'z': round(b['z'], 2),
             'value': b['value'], 'income': b['income'], 'sparkle': b.get('sparkle', False),
             'rarity': b.get('rarity', 'common'),
             'remaining': max(0, round(b['expire_at'] - now, 1))}
            for b in state['brainrots'].values()
        ],
        'pits': state['pits'][:80],
        'top': top,
        'pvp_enabled': state.get('pvp_enabled', True),
        'wall_settings': state['wall_settings'],
    })


def get_all_nicks():
    nicks = set(accounts.keys())
    for p in state['players'].values():
        if p['authenticated']:
            nicks.add(p['name'])
    return sorted(nicks)


def get_top(n=5):
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
    now = time.time()
    return {
        'players': {sid: light_player(p) for sid, p in state['players'].items() if p['authenticated']},
        'walls': state['walls'],
        'brainrots': [
            {'id': b['id'], 'x': round(b['x'], 2), 'z': round(b['z'], 2),
             'value': b['value'], 'income': b['income'], 'sparkle': b.get('sparkle', False),
             'rarity': b.get('rarity', 'common'),
             'remaining': max(0, round(b['expire_at'] - now, 1))}
            for b in state['brainrots'].values()
        ],
        'pits': state['pits'][:80],
        'top': get_top(),
        'pvp_enabled': state.get('pvp_enabled', True),
        'wall_settings': state['wall_settings'],
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
                 'rarity': b.get('rarity', 'common'),
                 'remaining': max(0, round(b['expire_at'] - time.time(), 1))}
                for b in state['brainrots'].values()
            ],
            'pits': state['pits'][:80],
            'shop': {'x': SHOP_X, 'z': SHOP_Z},
            'pad_cols': PAD_COLS, 'pad_xs': PAD_XS,
            'pad_z_start': PAD_Z_START, 'pad_z_step': PAD_Z_STEP,
            'weapons': WEAPONS,
            'armors': ARMORS,
            'rarities': RARITIES,
            'roulette_cost': ROULETTE_COST,
            'pvp_enabled': state.get('pvp_enabled', True),
            'wall_settings': state['wall_settings'],
        }, to=sid)


@socketio.on('ping_check')
def on_ping_check(data=None):
    return {'ok': True, 't': time.time()}


@socketio.on('attack')
def on_attack(data):
    sid = request.sid
    target_id = data.get('target')
    with lock:
        if not state.get('pvp_enabled', True):
            return
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return
        now = time.time()
        if p['attack_cd'] > 0:
            return
        if now < p['stun_until']:
            return
        if p['weapon_tier'] <= 0:
            return
        t = state['players'].get(target_id)
        if not t or not t['authenticated']:
            return
        if p['x'] < ROAD_START_X or t['x'] < ROAD_START_X:
            return
        dx = p['x'] - t['x']; dz = p['z'] - t['z']
        if dx * dx + dz * dz > ATTACK_RADIUS * ATTACK_RADIUS:
            return
        if now < t['invuln_until']:
            return
        tier = max(0, min(len(WEAPONS) - 1, p['weapon_tier']))
        dmg = WEAPONS[tier]['damage']
        if dmg <= 0:
            return
        if t.get('shield_active'):
            dmg = max(1, dmg * SHIELD_DAMAGE_MULT)
        t['damage_accum'] = t.get('damage_accum', 0) + dmg
        t['last_dmg_time'] = now
        p['attack_cd'] = ATTACK_CD
        hp_max = get_hp_max(t)
        if t['damage_accum'] >= hp_max:
            stun_player(t)


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

    if nick in state['banned']:
        socketio.emit('auth_res', {'ok': False, 'err': '🚫 Ник забанен'}, to=sid)
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
            p['weapon_tier'] = int(acc.get('weapon_tier', 0))
            p['armor_tier'] = int(acc.get('armor_tier', 0))
            p['has_shield'] = bool(acc.get('has_shield', False))
            p['shield_active'] = False
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


@socketio.on('admin_toggle_pvp')
def on_admin_toggle_pvp(data=None):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        if data and 'enabled' in data:
            state['pvp_enabled'] = bool(data['enabled'])
        else:
            state['pvp_enabled'] = not state.get('pvp_enabled', True)
        enabled = state['pvp_enabled']
        socketio.emit('pvp_state', {'enabled': enabled})
        socketio.emit('toast', {'text': f'PVP: {"ВКЛ" if enabled else "ВЫКЛ"}'})
        return {'ok': True, 'enabled': enabled}


@socketio.on('admin_set_walls')
def on_admin_set_walls(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        try:
            ws = state['wall_settings']
            if 'limit' in data: ws['limit'] = max(5, min(500, int(data['limit'])))
            if 'interval_min' in data: ws['interval_min'] = max(0.3, min(30.0, float(data['interval_min'])))
            if 'interval_range' in data: ws['interval_range'] = max(0.0, min(30.0, float(data['interval_range'])))
            if 'pack_max' in data: ws['pack_max'] = max(1, min(10, int(data['pack_max'])))
            if 'start_delay' in data: ws['start_delay'] = max(0.5, min(30.0, float(data['start_delay'])))
            save_wall_settings()
            socketio.emit('wall_settings_update', ws)
            return {'ok': True, 'wall_settings': ws}
        except Exception as e:
            return {'ok': False, 'err': f'Ошибка: {e}'}


@socketio.on('admin_list_nicks')
def on_admin_list_nicks():
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'nicks': []}
        return {'ok': True, 'nicks': get_all_nicks()}


def _find_online_sid_by_nick(nick):
    for tp_sid, tp in state['players'].items():
        if tp.get('authenticated') and tp['name'] == nick:
            return tp_sid
    return None


def _force_disconnect(sid):
    try:
        socketio.server.disconnect(sid, namespace='/')
    except Exception as e:
        print('[MOD] disconnect error:', e)


@socketio.on('admin_kick_player')
def on_admin_kick(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        nick = str(data.get('nick', '')).strip()
        if not nick:
            return {'ok': False, 'err': 'Ник не указан'}
        target_sid = _find_online_sid_by_nick(nick)
        if not target_sid:
            return {'ok': False, 'err': f'Игрок "{nick}" не в сети'}
        _force_disconnect(target_sid)
        text = f'👢 {nick} кикнут'
        socketio.emit('toast', {'text': text}, to=sid)
        return {'ok': True, 'text': text}


@socketio.on('admin_ban_player')
def on_admin_ban(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        nick = str(data.get('nick', '')).strip()
        if not nick:
            return {'ok': False, 'err': 'Ник не указан'}
        ban = bool(data.get('ban', True))
        if ban:
            state['banned'].add(nick)
        else:
            state['banned'].discard(nick)
        save_banned()
        if ban:
            target_sid = _find_online_sid_by_nick(nick)
            if target_sid:
                _force_disconnect(target_sid)
        text = f'{"🚫 " + nick + " забанен" if ban else "✅ " + nick + " разбанен"}'
        socketio.emit('toast', {'text': text}, to=sid)
        return {'ok': True, 'text': text, 'banned': ban}


@socketio.on('admin_delete_player')
def on_admin_delete(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p.get('is_admin'):
            return {'ok': False, 'err': 'Нет доступа'}
        nick = str(data.get('nick', '')).strip()
        if not nick:
            return {'ok': False, 'err': 'Ник не указан'}
        if nick == p['name']:
            return {'ok': False, 'err': 'Нельзя удалить самого себя'}

        target_sid = _find_online_sid_by_nick(nick)
        if target_sid:
            tp = state['players'].get(target_sid)
            if tp:
                tp['delete_pending'] = True
                tp['account'] = None

        existed = nick in accounts
        accounts.pop(nick, None)

        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute('DELETE FROM accounts WHERE nick = %s', (nick,))
                conn.commit()
        except Exception as e:
            print('[DB] delete error:', e)

        if target_sid:
            _force_disconnect(target_sid)

        text = f'❌ {nick} удалён' if existed else f'❌ {nick} не найден в БД'
        socketio.emit('toast', {'text': text}, to=sid)
        return {'ok': True, 'text': text}


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
                    'prestige': tp.get('prestige', 0),
                    'weapon_tier': tp.get('weapon_tier', 0),
                    'armor_tier': tp.get('armor_tier', 0),
                    'has_shield': tp.get('has_shield', False),
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
                'prestige': acc.get('prestige', 0),
                'weapon_tier': acc.get('weapon_tier', 0),
                'armor_tier': acc.get('armor_tier', 0),
                'has_shield': acc.get('has_shield', False),
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
                'weapon_tier': int(acc.get('weapon_tier', 0)),
                'armor_tier': int(acc.get('armor_tier', 0)),
                'has_shield': bool(acc.get('has_shield', False)),
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
            elif cmd == 'prestige':
                val = max(0, int(data.get('value', 0)))
                target['prestige'] = val
                target['income_multiplier'] = 1.0 + 0.5 * val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: престиж = {val} (×{target["income_multiplier"]})'}
            elif cmd == 'set_weapon':
                val = max(0, min(len(WEAPONS) - 1, int(data.get('value', 0))))
                target['weapon_tier'] = val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: оружие = {WEAPONS[val]["name"]}'}
            elif cmd == 'set_armor':
                val = max(0, min(len(ARMORS) - 1, int(data.get('value', 0))))
                target['armor_tier'] = val
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: броня = {ARMORS[val]["name"]}'}
            elif cmd == 'set_shield':
                val = bool(int(data.get('value', 0)))
                target['has_shield'] = val
                if not val:
                    target['shield_active'] = False
                persist_player(target); save_accounts()
                resp = {'ok': True, 'text': f'{target_nick}: щит = {"да" if val else "нет"}'}
            elif cmd == 'reset_player':
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
                target['weapon_tier'] = 0
                target['armor_tier'] = 0
                target['has_shield'] = False
                target['shield_active'] = False
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
                        target['base_pads'][idx] = {'value': val, 'income': inc, 'sparkle': False, 'rarity': 'common'}
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
        if not p:
            return
        if p.get('delete_pending'):
            return
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
            try:
                p['dx'] = max(-1.0, min(1.0, float(data['dx'])))
            except Exception:
                pass
        if 'dz' in data:
            try:
                p['dz'] = max(-1.0, min(1.0, float(data['dz'])))
            except Exception:
                pass
        if 'hold_e' in data:
            p['hold_e'] = bool(data['hold_e'])
        if 'hold_d' in data:
            p['hold_d'] = bool(data['hold_d'])
        if data.get('toggle_shield'):
            if p.get('has_shield'):
                p['shield_active'] = not p['shield_active']
            else:
                p['shield_active'] = False
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


@socketio.on('buy_weapon')
def on_buy_weapon(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Нет игрока'}
        tier = int(data.get('tier', 0))
        if tier < 0 or tier >= len(WEAPONS):
            return {'ok': False, 'err': 'Неверный уровень'}
        if tier <= p['weapon_tier']:
            return {'ok': False, 'err': 'У тебя уже есть это или лучше'}
        cost = WEAPONS[tier]['cost']
        if p['money'] < cost:
            return {'ok': False, 'err': f'Нужно {cost} монет'}
        p['money'] -= cost
        p['weapon_tier'] = tier
        persist_player(p); save_accounts()
        resp = {'ok': True, 'text': f'Куплено: {WEAPONS[tier]["name"]}'}
        socketio.emit('toast', {'text': resp['text']}, to=sid)
        return resp


@socketio.on('buy_armor')
def on_buy_armor(data):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Нет игрока'}
        tier = int(data.get('tier', 0))
        if tier < 0 or tier >= len(ARMORS):
            return {'ok': False, 'err': 'Неверный уровень'}
        if tier <= p['armor_tier']:
            return {'ok': False, 'err': 'У тебя уже есть это или лучше'}
        cost = ARMORS[tier]['cost']
        if p['money'] < cost:
            return {'ok': False, 'err': f'Нужно {cost} монет'}
        p['money'] -= cost
        p['armor_tier'] = tier
        p['damage_accum'] = 0
        persist_player(p); save_accounts()
        resp = {'ok': True, 'text': f'Надето: {ARMORS[tier]["name"]}'}
        socketio.emit('toast', {'text': resp['text']}, to=sid)
        return resp


@socketio.on('buy_shield')
def on_buy_shield(data=None):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Нет игрока'}
        if p.get('has_shield'):
            return {'ok': False, 'err': 'Уже куплено'}
        if p['money'] < SHIELD_COST:
            return {'ok': False, 'err': f'Нужно {SHIELD_COST} монет'}
        p['money'] -= SHIELD_COST
        p['has_shield'] = True
        persist_player(p); save_accounts()
        resp = {'ok': True, 'text': '🛡️ Щит куплен! V — вкл/выкл'}
        socketio.emit('toast', {'text': resp['text']}, to=sid)
        return resp


@socketio.on('spin_roulette')
def on_spin_roulette(data=None):
    sid = request.sid
    with lock:
        p = state['players'].get(sid)
        if not p or not p['authenticated']:
            return {'ok': False, 'err': 'Нет игрока'}
        if p['state'] != 'ground':
            return {'ok': False, 'err': 'Нельзя крутить в яме'}
        if p['money'] < ROULETTE_COST:
            return {'ok': False, 'err': f'Нужно {ROULETTE_COST}💰'}
        if len(p['carrying']) >= MAX_CARRY:
            return {'ok': False, 'err': 'Руки заняты — сначала убери верити'}

        p['money'] -= ROULETTE_COST

        keys = [r['weight'] for r in RARITIES]
        rarity = random.choices(RARITIES, weights=keys)[0]

        base_x = max(p['x'] + 20, ROAD_START_X + 100)
        base_v = brainrot_value_at(base_x)
        v = int(base_v * rarity['mult'])
        br = {
            'id': state['next_br_id'],
            'x': p['x'], 'z': p['z'],
            'value': v, 'income': brainrot_income(v),
            'sparkle': rarity['sparkle'],
            'rarity': rarity['key'],
            'expire_at': time.time() + BRAINROT_LIFE,
        }
        state['next_br_id'] += 1
        p['carrying'].append(br)

        persist_player(p)

        result = {
            'ok': True,
            'rarity': rarity['key'],
            'rarity_name': rarity['name'],
            'rarity_color': rarity['color'],
            'value': v,
            'income': br['income'],
            'sparkle': rarity['sparkle'],
            'cost': ROULETTE_COST,
        }
        socketio.emit('roulette_result', result, to=sid)
        return result


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
            p['weapon_tier'] = 0
            p['armor_tier'] = 0
            p['has_shield'] = False
            p['shield_active'] = False
            p['damage_accum'] = 0
            reset_pits()
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