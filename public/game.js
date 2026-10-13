import * as THREE from 'three';
import { G, socket, fmt } from './network.js';
import './input.js';
import './ui.js';

// ============================================================
//  КОНСТАНТЫ
// ============================================================
const LANE_HALF = 15, PIT_DEPTH = 4.0;
const SAFE_X_MIN = -100, SAFE_X_MAX = 150, SAFE_Z_HALF = 80;
const ROAD_START_X = SAFE_X_MAX;
const SHOP_X = 100, SHOP_Z = 0;
const PAD_COLS = 6, PAD_XS = [5,10,15,20,25,30], PAD_Z_START = -14, PAD_Z_STEP = 3.5;
const MAX_PADS = 50;

function padPos(i) {
  const c = i % PAD_COLS, r = Math.floor(i / PAD_COLS);
  return { x: PAD_XS[c], z: PAD_Z_START + r * PAD_Z_STEP };
}

// ============================================================
//  СЦЕНА
// ============================================================
const canvas = document.getElementById('game');
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

// ============================================================
//  ЛЕЙБЛЫ
// ============================================================
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

// ============================================================
//  ТЕРРЕЙН
// ============================================================
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

// ============================================================
//  ЗАБОРЫ
// ============================================================
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

// ============================================================
//  БАЗА
// ============================================================
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

// ============================================================
//  ПЭДЫ
// ============================================================
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

// ============================================================
//  ВЕРИТИ
// ============================================================
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

// ============================================================
//  МАГАЗИН
// ============================================================
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

// ============================================================
//  ГОЛОГРАММА ТОПА
// ============================================================
const topBoard = makeMultiline([{ text: '🏆 ТОП', size: 42, color: '#ffe066' }]);
topBoard.position.set(35, 14, 30);
topBoard.scale.set(14, 10, 1);
scene.add(topBoard);
let lastTopJson = '';

// ============================================================
//  ПЕРСОНАЖ
// ============================================================
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

// ============================================================
//  ГРУППЫ
// ============================================================
const playerGroup = new THREE.Group();
const wallGroup = new THREE.Group();
const brainrotGroup = new THREE.Group();
scene.add(playerGroup, wallGroup, brainrotGroup);

function updateFromServer() {
  const seen = new Set();
  for (const id in G.serverData.players) {
    const p = G.serverData.players[id];
    seen.add(id);
    let st = G.playerStates.get(id);
    const isMe = id === G.me;
    if (!st) {
      const mesh = makeHumanoid(isMe ? 0x00b8e5 : 0xe55599, isMe);
      playerGroup.add(mesh);
      st = {
        mesh,
        current: new THREE.Vector3(p.x, p.y || 0, p.z),
        target: new THREE.Vector3(p.x, p.y || 0, p.z),
        data: p, isMe, lastInfo: ''
      };
      G.playerStates.set(id, st);
    }
    st.target.set(p.x, p.y || 0, p.z);
    st.data = p;
  }
  for (const [id, st] of G.playerStates) {
    if (!seen.has(id)) { playerGroup.remove(st.mesh); G.playerStates.delete(id); }
  }

  const seenW = new Set();
  for (const w of G.serverData.walls) {
    seenW.add(w.id);
    let st = G.wallStates.get(w.id);
    if (!st) {
      const mesh = makeWallMesh(w.color, w.label, w.w);
      wallGroup.add(mesh);
      st = { mesh, current: new THREE.Vector3(w.x, 0, w.z), target: new THREE.Vector3(w.x, 0, w.z), data: w };
      G.wallStates.set(w.id, st);
    }
    st.target.set(w.x, 0, w.z);
    st.data = w;
  }
  for (const [id, st] of G.wallStates) {
    if (!seenW.has(id)) { wallGroup.remove(st.mesh); G.wallStates.delete(id); }
  }

  const seenB = new Set();
  for (const b of G.serverData.brainrots) {
    seenB.add(b.id);
    let st = G.brainrotStates.get(b.id);
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
      G.brainrotStates.set(b.id, st);
    }
    st.target.set(b.x, 0, b.z);
    st.data = b;
  }
  for (const [id, st] of G.brainrotStates) {
    if (!seenB.has(id)) { brainrotGroup.remove(st.mesh); G.brainrotStates.delete(id); }
  }
}

// ============================================================
//  PLAYER:HIT
// ============================================================
socket.on('player:hit', d => {
  if (d.id !== G.me) return;
  const f = document.getElementById('flash'), m = document.getElementById('hitMsg');
  f.style.background = 'rgba(231,76,60,0.55)';
  m.classList.add('show');
  setTimeout(() => f.style.background = 'rgba(231,76,60,0)', 140);
  setTimeout(() => m.classList.remove('show'), 800);
  const st = G.playerStates.get(G.me);
  if (st) { st.current.set(ROAD_START_X - 15, 0, 0); st.target.set(ROAD_START_X - 15, 0, 0); }
});

// ============================================================
//  ГЛАВНЫЙ ЦИКЛ
// ============================================================
const camTarget = new THREE.Vector3(40, 10, 0);
const camLook = new THREE.Vector3(60, 2.5, 0);

function frame() {
  requestAnimationFrame(frame);
  const t = performance.now() / 1000;
  updateFromServer();
  const my = G.playerStates.get(G.me);

  for (const [id, st] of G.playerStates) {
    st.current.lerp(st.target, 0.55);
    st.mesh.position.copy(st.current);

    // Плавный поворот по facing
    const targetRot = -(st.data.facing || 0);
    let diff = targetRot - st.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    st.mesh.rotation.y += diff * 0.25;

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

    if (G.chatHead && st.data.chat_msg) {
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

  for (const [, st] of G.wallStates) {
    st.current.lerp(st.target, 0.55);
    st.mesh.position.copy(st.current);
  }

  const myPos = my ? my.current : new THREE.Vector3();
  for (const [, st] of G.brainrotStates) {
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

  rebuildTerrain(G.serverData.pits);

  {
    const top = G.serverData.top || [];
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
    const cosY = Math.cos(G.camYaw), sinY = Math.sin(G.camYaw);
    const cosP = Math.cos(G.camPitch), sinP = Math.sin(G.camPitch);
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