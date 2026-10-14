import * as THREE from 'three';

/* ================= MiniCraft 3D — voxel builder for Phone/Tablet/PC ================= */
const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
let toastT = 0;
function toast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastT);
  toastT = setTimeout(() => (toastEl.style.opacity = '0'), ms);
}

// ---------- Config ----------
const WORLD_X = 64, WORLD_Y = 36, WORLD_Z = 64;
const SEA = 11;
const CHUNK = 16;
const REACH = 7;

// Block ids
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, LOG = 5,
      LEAVES = 6, PLANKS = 7, GLASS = 8, BRICK = 9, WATER = 10, COBBLE = 11;

const BLOCKS = {
  [GRASS]:  { name: 'Grass' },
  [DIRT]:   { name: 'Dirt' },
  [STONE]:  { name: 'Stone' },
  [COBBLE]: { name: 'Cobble' },
  [PLANKS]: { name: 'Planks' },
  [LOG]:    { name: 'Wood' },
  [LEAVES]: { name: 'Leaves' },
  [SAND]:   { name: 'Sand' },
  [GLASS]:  { name: 'Glass' },
  [BRICK]:  { name: 'Brick' },
};
const HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, LEAVES, SAND, BRICK, GLASS].slice(0, 9);

// tile indices in atlas (8 cols)
const T = { grassTop: 0, grassSide: 1, dirt: 2, stone: 3, logSide: 4, logTop: 5, leaves: 6, sand: 7, planks: 8, glass: 9, brick: 10, water: 11, cobble: 12 };
function tilesFor(id, face) { // face: px,nx,py,ny,pz,nz
  switch (id) {
    case GRASS: return face === 'py' ? T.grassTop : face === 'ny' ? T.dirt : T.grassSide;
    case DIRT: return T.dirt;
    case STONE: return T.stone;
    case COBBLE: return T.cobble;
    case SAND: return T.sand;
    case LOG: return (face === 'py' || face === 'ny') ? T.logTop : T.logSide;
    case LEAVES: return T.leaves;
    case PLANKS: return T.planks;
    case GLASS: return T.glass;
    case BRICK: return T.brick;
    case WATER: return T.water;
    default: return T.stone;
  }
}
const isOpaque = (id) => id !== AIR && id !== WATER;

// ---------- Seeded RNG + noise ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 69069) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed) {
  return valueNoise(x, y, seed) * 0.55 + valueNoise(x * 2.1 + 13.7, y * 2.1 + 7.3, seed) * 0.28 + valueNoise(x * 4.3 + 31.1, y * 4.3 + 17.7, seed) * 0.17;
}

// ---------- World storage ----------
const world = new Uint8Array(WORLD_X * WORLD_Y * WORLD_Z);
const widx = (x, y, z) => (y * WORLD_Z + z) * WORLD_X + x;
function inWorld(x, y, z) { return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z; }
function getBlock(x, y, z) {
  if (y < 0) return STONE;
  if (!inWorld(x, y, z)) return AIR;
  return world[widx(x, y, z)];
}
function setBlock(x, y, z, id) { if (inWorld(x, y, z)) world[widx(x, y, z)] = id; }
function isSolid(x, y, z) {
  // invisible walls at world edge
  if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return true;
  if (y < 0) return true;
  if (y >= WORLD_Y) return false;
  const id = world[widx(x, y, z)];
  return id !== AIR && id !== WATER;
}

let seed = 1337;
function heightAt(x, z) {
  const n = fbm(x * 0.045, z * 0.045, seed);
  const m = fbm(x * 0.13 + 50, z * 0.13 + 50, seed + 7);
  return Math.max(2, Math.min(WORLD_Y - 10, Math.floor(8 + n * 14 + (m - 0.5) * 4)));
}

function generateWorld(newSeed) {
  seed = newSeed >>> 0;
  world.fill(AIR);
  const rng = mulberry32(seed);
  for (let x = 0; x < WORLD_X; x++) {
    for (let z = 0; z < WORLD_Z; z++) {
      const h = heightAt(x, z);
      const beach = h <= SEA + 1;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === h) id = beach ? SAND : (h < SEA - 1 ? DIRT : GRASS);
        else if (y > h - 4) id = beach ? SAND : DIRT;
        else id = STONE;
        // sprinkle cobble/stone variation underground
        if (id === STONE && rng() < 0.06) id = COBBLE;
        world[widx(x, y, z)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) world[widx(x, y, z)] = WATER;
    }
  }
  // trees
  for (let i = 0; i < 90; i++) {
    const x = 3 + Math.floor(rng() * (WORLD_X - 6));
    const z = 3 + Math.floor(rng() * (WORLD_Z - 6));
    const h = heightAt(x, z);
    if (h <= SEA + 1 || h > WORLD_Y - 9) continue;
    if (getBlock(x, h, z) !== GRASS) continue;
    // avoid clumping: cheap check
    if (rng() < 0.35) continue;
    const th = 4 + Math.floor(rng() * 2);
    for (let y = h + 1; y <= h + th; y++) setBlock(x, y, z, LOG);
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.6) continue;
        const bx = x + dx, by = h + th + dy, bz = z + dz;
        if (inWorld(bx, by, bz) && getBlock(bx, by, bz) === AIR) setBlock(bx, by, bz, LEAVES);
      }
    }
    setBlock(x, h + th + 2, z, LEAVES);
  }
}

// ---------- Texture atlas (procedural 16px pixel art) ----------
const TILE = 16, ACOLS = 8, AROWS = 2;
function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = ACOLS * TILE; cv.height = AROWS * TILE;
  const ctx = cv.getContext('2d');
  const rng = mulberry32(99);
  const px = (tx, ty, x, y, c) => { ctx.fillStyle = c; ctx.fillRect(tx * TILE + x, ty * TILE + y, 1, 1); };
  const tileXY = (t) => [t % ACOLS, Math.floor(t / ACOLS)];
  function fill(t, base, vary = 12) {
    const [tx, ty] = tileXY(t);
    const b = hex2rgb(base);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = (rng() - 0.5) * 2 * vary;
      px(tx, ty, x, y, rgb(b[0] + v, b[1] + v, b[2] + v));
    }
  }
  function hex2rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

  fill(T.grassTop, '#6abe30', 10);
  // grass side: dirt + green top strip
  fill(T.grassSide, '#7a5230', 12);
  { const [tx, ty] = tileXY(T.grassSide);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
      const v = (rng() - 0.5) * 16;
      const edge = y === 3 ? rng() < 0.5 : true;
      if (edge) px(tx, ty, x, y, rgb(106 + v, 190 + v, 48 + v));
    } }
  fill(T.dirt, '#7a5230', 13);
  fill(T.stone, '#8d8d8d', 9);
  fill(T.logSide, '#5d4126', 8);
  { const [tx, ty] = tileXY(T.logSide);
    for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) px(tx, ty, x, y, '#4a3319'); }
  fill(T.logTop, '#a0824f', 8);
  { const [tx, ty] = tileXY(T.logTop);
    ctx.strokeStyle = '#6b5330'; ctx.lineWidth = 1;
    ctx.strokeRect(tx * TILE + 1.5, ty * TILE + 1.5, 13, 13);
    ctx.strokeRect(tx * TILE + 4.5, ty * TILE + 4.5, 7, 7); }
  fill(T.leaves, '#2f8f2e', 16);
  { const [tx, ty] = tileXY(T.leaves);
    for (let i = 0; i < 26; i++) px(tx, ty, (rng() * 16) | 0, (rng() * 16) | 0, '#1e5c1d'); }
  fill(T.sand, '#e3d9a3', 8);
  fill(T.planks, '#b08a4f', 7);
  { const [tx, ty] = tileXY(T.planks);
    ctx.fillStyle = '#7d5f31';
    for (let y = 3; y < 16; y += 4) ctx.fillRect(tx * TILE, ty * TILE + y, 16, 1);
    ctx.fillRect(tx * TILE + 7, ty * TILE, 1, 16); }
  { const [tx, ty] = tileXY(T.glass);
    ctx.fillStyle = '#dff3f7'; ctx.fillRect(tx * TILE, ty * TILE, 16, 16);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(tx * TILE, ty * TILE, 16, 2);
    ctx.fillRect(tx * TILE, ty * TILE, 2, 16); ctx.fillRect(tx * TILE + 14, ty * TILE, 2, 16);
    ctx.fillRect(tx * TILE, ty * TILE + 14, 16, 2);
    ctx.fillStyle = '#bfe6ee';
    for (let i = 0; i < 8; i++) px(tx, ty, 4 + i, 10 - i, '#ffffff'); }
  fill(T.brick, '#9e4a38', 6);
  { const [tx, ty] = tileXY(T.brick);
    ctx.fillStyle = '#d8cfc4';
    for (let y = 3; y < 16; y += 4) ctx.fillRect(tx * TILE, ty * TILE + y, 16, 1);
    for (let y = 0; y < 16; y += 4) ctx.fillRect(tx * TILE + ((y / 4) % 2 ? 4 : 11), ty * TILE + y, 1, 4); }
  fill(T.water, '#3b7fe0', 10);
  { const [tx, ty] = tileXY(T.water);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let y = 2; y < 16; y += 5) for (let x = 0; x < 16; x += 3) ctx.fillRect(tx * TILE + x + (y % 2), ty * TILE + y, 2, 1); }
  fill(T.cobble, '#7e7e7e', 10);
  { const [tx, ty] = tileXY(T.cobble);
    ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 1;
    ctx.strokeRect(tx * TILE + 1.5, ty * TILE + 1.5, 6, 6);
    ctx.strokeRect(tx * TILE + 8.5, ty * TILE + 1.5, 6, 6);
    ctx.strokeRect(tx * TILE + 1.5, ty * TILE + 8.5, 6, 6);
    ctx.strokeRect(tx * TILE + 8.5, ty * TILE + 8.5, 6, 6); }

  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas: cv, texture: tex };
}

// ---------- Three.js scene ----------
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x9fd3e8, 30, 110);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 400);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a8f4e, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
scene.add(sun);
scene.add(sun.target);

const atlas = makeAtlas();
const matOpaque = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
const matWater = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });

// ---------- Meshing ----------
const OX = -WORLD_X / 2, OZ = -WORLD_Z / 2;
const FACES = [
  { d: 'px', dir: [1, 0, 0], shade: 0.8, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { d: 'nx', dir: [-1, 0, 0], shade: 0.8, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: 'py', dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { d: 'ny', dir: [0, -1, 0], shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: 'pz', dir: [0, 0, 1], shade: 0.7, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: 'nz', dir: [0, 0, -1], shade: 0.7, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
function tileUV(tile) {
  const col = tile % ACOLS, row = Math.floor(tile / ACOLS);
  const AW = ACOLS * TILE, AH = AROWS * TILE, ins = 0.4;
  const u0 = (col * TILE + ins) / AW, u1 = (col * TILE + TILE - ins) / AW;
  const v1 = 1 - (row * TILE + ins) / AH, v0 = 1 - (row * TILE + TILE - ins) / AH;
  return [u0, v0, u1, v1];
}

const chunkMeshes = new Map(); // key cx,cz -> [opaqueMesh, waterMesh]
const chunkGroup = new THREE.Group();
scene.add(chunkGroup);

function buildChunk(cx, cz) {
  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) { for (const m of old) { chunkGroup.remove(m); m.geometry.dispose(); } chunkMeshes.delete(key); }

  const pos = [], norm = [], uv = [], col = [], wpos = [], wnorm = [], wuv = [], wcol = [];
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let x = x0; x < Math.min(x0 + CHUNK, WORLD_X); x++) {
    for (let z = z0; z < Math.min(z0 + CHUNK, WORLD_Z); z++) {
      for (let y = 0; y < WORLD_Y; y++) {
        const id = world[widx(x, y, z)];
        if (id === AIR) continue;
        const isWater = id === WATER;
        for (const f of FACES) {
          const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
          const n = getBlock(nx, ny, nz);
          let show;
          if (isWater) show = n !== WATER && n !== undefined && (f.dir[1] >= 0 ? true : n === AIR || !isOpaque(n));
          else show = !isOpaque(n);
          // hide faces on world side walls below ground? keep them (visible from outside)
          if (!show) continue;
          const tile = tilesFor(id, f.d);
          const [u0, v0, u1, v1] = tileUV(tile);
          // water top face slightly lower
          const yTop = (isWater && f.d === 'py') ? 0.88 : 1;
          const target = isWater ? { p: wpos, n: wnorm, u: wuv, c: wcol } : { p: pos, n: norm, u: uv, c: col };
          // corner data for quad (0,1,2,3) -> triangles (0,1,2),(0,2,3)
          const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
          const quad = [0, 1, 2, 0, 2, 3];
          for (const k of quad) {
            const c = f.corners[k];
            const vy = (f.d === 'py' && isWater) ? yTop : c[1];
            target.p.push(x + OX + c[0], y + vy, z + OZ + c[2]);
            target.n.push(f.dir[0], f.dir[1], f.dir[2]);
            target.u.push(uvs[k][0], uvs[k][1]);
            let s = f.shade;
            if (isWater) s *= 0.95;
            target.c.push(s, s, s);
          }
        }
      }
    }
  }
  const made = [];
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, matOpaque);
    chunkGroup.add(m); made.push(m);
  }
  if (wpos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(wnorm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
    const m = new THREE.Mesh(g, matWater);
    m.renderOrder = 2;
    chunkGroup.add(m); made.push(m);
  }
  chunkMeshes.set(key, made);
}
function buildAll() {
  for (let cx = 0; cx < WORLD_X / CHUNK; cx++)
    for (let cz = 0; cz < WORLD_Z / CHUNK; cz++) buildChunk(cx, cz);
}
function dirtyAt(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  buildChunk(cx, cz);
  // rebuild neighbor chunks if on border
  if (x % CHUNK === 0 && cx > 0) buildChunk(cx - 1, cz);
  if (x % CHUNK === CHUNK - 1 && cx < WORLD_X / CHUNK - 1) buildChunk(cx + 1, cz);
  if (z % CHUNK === 0 && cz > 0) buildChunk(cx, cz - 1);
  if (z % CHUNK === CHUNK - 1 && cz < WORLD_Z / CHUNK - 1) buildChunk(cx, cz + 1);
}

// ---------- Highlight box ----------
const hlBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 })
);
hlBox.visible = false;
scene.add(hlBox);

// ---------- Clouds ----------
const clouds = new THREE.Group();
{
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const rng = mulberry32(7);
  for (let i = 0; i < 24; i++) {
    const w = 4 + rng() * 8;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 3 + rng() * 5), cm);
    m.position.set((rng() - 0.5) * 120, 30 + rng() * 3, (rng() - 0.5) * 120);
    clouds.add(m);
  }
}
scene.add(clouds);

// ---------- Player ----------
const player = {
  pos: new THREE.Vector3(0, 20, 0), // feet
  vel: new THREE.Vector3(),
  yaw: Math.PI * 0.25, pitch: -0.1,
  onGround: false, fly: false,
};
const EYE = 1.62, PR = 0.3, PH = 1.8;

function openScore(x, h, z) {
  // [bestYaw, bestScore]: openness at eye level + canopy penalty
  let best = 0, bestScore = -1;
  for (let a = 0; a < 8; a++) {
    const yaw = (a / 8) * Math.PI * 2;
    const dxn = -Math.sin(yaw), dzn = -Math.cos(yaw);
    let score = 0;
    for (let s = 1; s <= 5; s++) {
      const bx = Math.floor(x + dxn * s), bz = Math.floor(z + dzn * s);
      for (let by = h + 1; by <= h + 2; by++) {
        if (!inWorld(bx, by, bz) || getBlock(bx, by, bz) === AIR) score++;
      }
      for (let by = h + 3; by <= h + 4; by++) {
        if (!inWorld(bx, by, bz) || getBlock(bx, by, bz) === AIR) score += 0.25;
      }
    }
    // tiny deterministic jitter so ties don't always pick yaw 0
    score += hash2(x, z, 5) * 0.5;
    if (score > bestScore) { bestScore = score; best = yaw; }
  }
  return [best, bestScore];
}
function findSpawn() {
  const cx = WORLD_X >> 1, cz = WORLD_Z >> 1;
  let fallback = null;
  for (let r = 0; r < 24; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const x = cx + dx, z = cz + dz;
      if (x < 1 || z < 1 || x >= WORLD_X - 1 || z >= WORLD_Z - 1) continue;
      const h = heightAt(x, z);
      if (h > SEA + 1 && getBlock(x, h, z) === GRASS) {
        const [yaw, score] = openScore(x, h, z);
        if (score >= 19) {
          player.pos.set(x + OX + 0.5, h + 1.01, z + OZ + 0.5);
          player.vel.set(0, 0, 0);
          player.yaw = yaw;
          player.pitch = -0.15;
          return;
        }
        if (!fallback || score > fallback[3]) fallback = [x, h, z, score, yaw];
      }
    }
  }
  if (fallback) {
    player.pos.set(fallback[0] + OX + 0.5, fallback[1] + 1.01, fallback[2] + OZ + 0.5);
    player.vel.set(0, 0, 0);
    player.yaw = fallback[4];
    player.pitch = -0.15;
    return;
  }
  player.pos.set(OX + WORLD_X / 2, 20, OZ + WORLD_Z / 2);
}

function collideMove(dt) {
  const p = player.pos, v = player.vel;
  // X axis
  p.x += v.x * dt;
  if (collides(p)) {
    p.x -= v.x * dt;
    const step = Math.sign(v.x) * 0.05;
    while (Math.abs(step) > 0.001 && !collides(p)) p.x += step;
    // revert last step if colliding
    if (collides(p)) p.x -= step;
    v.x = 0;
  }
  // Z axis
  p.z += v.z * dt;
  if (collides(p)) {
    p.z -= v.z * dt;
    const step = Math.sign(v.z) * 0.05;
    while (Math.abs(step) > 0.001 && !collides(p)) p.z += step;
    if (collides(p)) p.z -= step;
    v.z = 0;
  }
  // Y axis
  p.y += v.y * dt;
  player.onGround = false;
  if (collides(p)) {
    if (v.y <= 0) player.onGround = true;
    p.y -= v.y * dt;
    const step = Math.sign(v.y) * 0.05;
    let moved = 0;
    while (Math.abs(moved) < Math.abs(v.y * dt) && !collides({ x: p.x, y: p.y + step, z: p.z })) { p.y += step; moved += Math.abs(step); }
    v.y = 0;
  }
  // safety: fell out of world
  if (p.y < -10) findSpawn();
}
function collides(p) {
  const x0 = Math.floor(p.x - OX - PR), x1 = Math.floor(p.x - OX + PR);
  const z0 = Math.floor(p.z - OZ - PR), z1 = Math.floor(p.z - OZ + PR);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + PH - 0.01);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++)
    if (isSolid(x, y, z)) return true;
  return false;
}
function inWater() {
  const x = Math.floor(player.pos.x - OX), z = Math.floor(player.pos.z - OZ);
  const y = Math.floor(player.pos.y + 1.0);
  return inWorld(x, y, z) && world[widx(x, y, z)] === WATER;
}

// ---------- Input ----------
const keys = {};
let playing = false;
let selected = HOTBAR[0];
const joy = { x: 0, y: 0, id: -1 };
const look = { id: -1, lx: 0, ly: 0 };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!playing) return;
  if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1);
  }
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyE') doPlace();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

function toggleFly() {
  player.fly = !player.fly;
  player.vel.y = 0;
  $('btn-fly-top').textContent = player.fly ? '🕊️ Fly: On' : '🕊️ Fly: Off';
  toast(player.fly ? 'Fly mode ON — Space up / C down' : 'Fly mode OFF');
}

// mouse look (pointer lock) + break/place
const canvas = renderer.domElement;
let breaking = false, placing = false, actionCd = 0;
canvas.addEventListener('click', () => {
  if (playing && !isTouch() && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {});
document.addEventListener('mousemove', (e) => {
  if (!playing || document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0026;
  player.pitch -= e.movementY * 0.0026;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});
canvas.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (e.button === 0) { breaking = true; doBreak(); }
  if (e.button === 2) { placing = true; doPlace(); }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) breaking = false;
  if (e.button === 2) placing = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (!playing) return;
  const i = HOTBAR.indexOf(selected);
  const n = (i + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
  selectSlot(n);
}, { passive: true });

function isTouch() { return matchMedia('(pointer: coarse)').matches; }

// touch: joystick + look-drag + buttons
const joyEl = $('joystick'), stickEl = $('stick');
joyEl.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); moveStick(e); });
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) moveStick(e); });
const endJoy = (e) => { if (e.pointerId === joy.id) { joy.id = -1; joy.x = joy.y = 0; stickEl.style.transform = 'translate(-50%,-50%)'; } };
joyEl.addEventListener('pointerup', endJoy);
joyEl.addEventListener('pointercancel', endJoy);
function moveStick(e) {
  const r = joyEl.getBoundingClientRect();
  let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  joy.x = dx; joy.y = dy;
  stickEl.style.transform = `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
}
// look drag anywhere on canvas (touch)
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (look.id === -1) { look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY; }
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === look.id) {
      player.yaw -= (t.clientX - look.lx) * 0.005;
      player.pitch -= (t.clientY - look.ly) * 0.005;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
      look.lx = t.clientX; look.ly = t.clientY;
    }
  }
  e.preventDefault();
}, { passive: false });
const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === look.id) look.id = -1; };
canvas.addEventListener('touchend', endLook);
canvas.addEventListener('touchcancel', endLook);

$('btn-jump').addEventListener('pointerdown', (e) => { e.preventDefault(); keys.Space = true; });
window.addEventListener('pointerup', () => (keys.Space = false));
$('btn-break').addEventListener('click', () => doBreak());
$('btn-place').addEventListener('click', () => doPlace());
$('btn-fly-top').addEventListener('click', () => { if (playing) toggleFly(); });
$('btn-help').addEventListener('click', () => $('help').classList.remove('hidden'));
$('btn-close-help').addEventListener('click', () => $('help').classList.add('hidden'));
$('btn-regen').addEventListener('click', () => {
  const s = (Math.random() * 1e9) | 0;
  $('seed').value = s;
  newWorld(s);
});
$('btn-dice').addEventListener('click', () => ($('seed').value = (Math.random() * 1e9) | 0));

// ---------- Raycast (DDA) ----------
function raycast(maxDist = REACH) {
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  const ox = player.pos.x - OX, oy = player.pos.y + EYE, oz = player.pos.z - OZ;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const fx = ox - x, fy = oy - y, fz = oz - z;
  let tMaxX = stepX !== 0 ? (stepX > 0 ? (1 - fx) : fx) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? (stepY > 0 ? (1 - fy) : fy) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? (stepZ > 0 ? (1 - fz) : fz) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 64; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    if (t > maxDist) return null;
    if (!inWorld(x, y, z)) continue;
    const id = world[widx(x, y, z)];
    if (id !== AIR && id !== WATER) return { x, y, z, nx, ny, nz, id };
  }
  return null;
}

function doBreak() {
  if (!playing) return;
  const hit = raycast();
  if (!hit) return;
  if (hit.y === 0) { toast('Bedrock — cannot break'); return; }
  setBlock(hit.x, hit.y, hit.z, AIR);
  dirtyAt(hit.x, hit.z);
  scheduleSave();
}
function doPlace() {
  if (!playing) return;
  const hit = raycast();
  if (!hit) return;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (!inWorld(x, y, z)) return;
  const cur = getBlock(x, y, z);
  if (cur !== AIR && cur !== WATER) return;
  // don't place inside player
  const px0 = Math.floor(player.pos.x - OX - PR), px1 = Math.floor(player.pos.x - OX + PR);
  const pz0 = Math.floor(player.pos.z - OZ - PR), pz1 = Math.floor(player.pos.z - OZ + PR);
  const py0 = Math.floor(player.pos.y), py1 = Math.floor(player.pos.y + PH - 0.01);
  if (x >= px0 && x <= px1 && z >= pz0 && z <= pz1 && y >= py0 && y <= py1 && selected !== WATER) { toast('Too close to place'); return; }
  setBlock(x, y, z, selected);
  dirtyAt(x, z);
  scheduleSave();
}

// ---------- Hotbar UI ----------
const hotbarEl = $('hotbar');
function blockIcon(id, size = 30) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // draw isometric-ish cube: top + two sides using atlas tiles
  const tile = tilesFor(id, 'py');
  const sx = (tile % ACOLS) * TILE, sy = Math.floor(tile / ACOLS) * TILE;
  g.drawImage(atlas.canvas, sx, sy, TILE, TILE, 2, 0, 28, 14);
  const t2 = tilesFor(id, 'pz');
  g.globalAlpha = 0.85;
  g.drawImage(atlas.canvas, (t2 % ACOLS) * TILE, Math.floor(t2 / ACOLS) * TILE, TILE, TILE, 2, 14, 28, 16);
  void size;
  return c;
}
function buildHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'slot' + (id === selected ? ' sel' : '');
    d.title = BLOCKS[id].name;
    d.appendChild(blockIcon(id));
    const s = document.createElement('span');
    s.textContent = `${i + 1} ${BLOCKS[id].name}`;
    d.appendChild(s);
    d.addEventListener('pointerdown', (e) => { e.preventDefault(); selectSlot(i); });
    hotbarEl.appendChild(d);
  });
}
function selectSlot(i) {
  selected = HOTBAR[i];
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('sel', j === i));
}

// ---------- Save / load ----------
const SAVE_KEY = 'minicraft3d-v1';
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
function saveNow() {
  try {
    // base64 of world bytes
    let bin = '';
    const CH = 8192;
    for (let i = 0; i < world.length; i += CH) bin += String.fromCharCode(...world.subarray(i, i + CH));
    localStorage.setItem(SAVE_KEY, JSON.stringify({ seed, px: +player.pos.x.toFixed(2), py: +player.pos.y.toFixed(2), pz: +player.pos.z.toFixed(2), data: btoa(bin) }));
  } catch { /* quota — ignore */ }
}
function tryLoad() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s.seed !== seed || !s.data) return false;
    const bin = atob(s.data);
    if (bin.length !== world.length) return false;
    for (let i = 0; i < bin.length; i++) world[i] = bin.charCodeAt(i);
    player.pos.set(s.px, s.py, s.pz);
    return true;
  } catch { return false; }
}
window.addEventListener('beforeunload', saveNow);

// ---------- New world / start ----------
const loadingEl = $('loading');
function newWorld(s) {
  loadingEl.classList.remove('hidden');
  setTimeout(() => {
    generateWorld(s);
    buildAll();
    findSpawn();
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    loadingEl.classList.add('hidden');
  }, 30);
}

$('btn-play').addEventListener('click', () => {
  const s = parseInt($('seed').value, 10);
  const useSeed = Number.isFinite(s) ? s : 1337;
  $('menu').classList.add('hidden');
  playing = true;
  if (useSeed !== seed || chunkMeshes.size === 0) {
    seed = useSeed;
    loadingEl.classList.remove('hidden');
    setTimeout(() => {
      generateWorld(useSeed);
      if (!tryLoad()) findSpawn();
      buildAll();
      buildHotbar();
      loadingEl.classList.add('hidden');
      toast(isTouch() ? 'Left stick to move · drag to look · ⛏ break · 🧱 place' : 'Click to lock mouse · WASD move · LMB break · RMB place');
      if (!isTouch()) canvas.requestPointerLock?.();
    }, 30);
  } else {
    toast('Welcome back!');
    if (!isTouch()) canvas.requestPointerLock?.();
  }
});

// boot world behind menu so capture + first paint look alive
generateWorld(parseInt($('seed').value, 10) || 1337);
buildAll();
findSpawn();
buildHotbar();
loadingEl.classList.add('hidden');
// gentle intro camera orbit before play
let introT = 0;
const introCam = { r: 26, h: 22, a: 0.6 };

// auto-start via ?play=1 (useful for embeds/tests)
if (new URLSearchParams(location.search).has('play')) $('btn-play').click();

// ---------- Day cycle ----------
let dayT = 0.35; // 0..1
function updateSky(dt) {
  dayT = (dayT + dt * 0.004) % 1;
  const ang = dayT * Math.PI * 2;
  const cx = WORLD_X / 2 + OX, cz = WORLD_Z / 2 + OZ;
  sun.position.set(cx + Math.cos(ang) * 60, Math.sin(ang) * 60 + 20, cz + 20);
  const daylight = Math.max(0.15, Math.sin(ang));
  sun.intensity = 0.4 + daylight * 1.4;
  hemi.intensity = 0.35 + daylight * 0.7;
  const sky = new THREE.Color(0x0b1026).lerp(new THREE.Color(0x87ceeb), Math.min(1, daylight * 1.6));
  scene.background = sky;
  scene.fog.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.15);
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fpsT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();

function updatePlayer(dt) {
  // look from keyboard arrows (accessibility)
  if (keys.ArrowLeft) player.yaw += 1.8 * dt;
  if (keys.ArrowRight) player.yaw -= 1.8 * dt;
  if (keys.ArrowUp) player.pitch = Math.min(1.55, player.pitch + 1.4 * dt);
  if (keys.ArrowDown) player.pitch = Math.max(-1.55, player.pitch - 1.4 * dt);

  const speed = player.fly ? 10 : inWater() ? 3.4 : 5.6;
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  rgt.set(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3();
  if (playing) {
    if (keys.KeyW) mv.add(fwd);
    if (keys.KeyS) mv.sub(fwd);
    if (keys.KeyD) mv.add(rgt);
    if (keys.KeyA) mv.sub(rgt);
    mv.x += -joy.y * 0 + joy.x * rgt.x + -joy.y * fwd.x;
    mv.z += joy.x * rgt.z + -joy.y * fwd.z;
    // touch jump held
  }
  if (mv.lengthSq() > 1) mv.normalize();
  mv.multiplyScalar(speed);
  player.vel.x = mv.x;
  player.vel.z = mv.z;

  if (player.fly) {
    let vy = 0;
    if (keys.Space) vy += 8;
    if (keys.KeyC || keys.ShiftLeft) vy -= 8;
    // joystick up/down? use jump button only
    player.vel.y += (vy - player.vel.y) * Math.min(1, dt * 8);
  } else {
    const g = inWater() ? -8 : -26;
    player.vel.y += g * dt;
    if (inWater() && keys.Space) player.vel.y = Math.min(player.vel.y + 40 * dt, 4);
    else if (keys.Space && player.onGround) { player.vel.y = 8.6; player.onGround = false; }
    player.vel.y = Math.max(player.vel.y, -40);
  }
  collideMove(dt);

  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // continuous break/place while held
  actionCd -= dt;
  if ((breaking || placing) && actionCd <= 0) {
    actionCd = 0.25;
    if (breaking) doBreak();
    else doPlace();
  }
}

function updateHighlight() {
  if (!playing) { hlBox.visible = false; $('highlight-label').style.display = 'none'; return; }
  const hit = raycast();
  if (!hit) { hlBox.visible = false; $('highlight-label').style.display = 'none'; return; }
  hlBox.visible = true;
  hlBox.position.set(hit.x + OX + 0.5, hit.y + 0.5, hit.z + OZ + 0.5);
  const lbl = $('highlight-label');
  lbl.style.display = 'block';
  lbl.textContent = BLOCKS[hit.id]?.name ?? '';
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateSky(dt);
  clouds.position.x += dt * 0.6;
  if (clouds.position.x > 60) clouds.position.x = -60;

  if (!playing) {
    introT += dt;
    introCam.a += dt * 0.08;
    const cx = OX + WORLD_X / 2, cz = OZ + WORLD_Z / 2;
    camera.position.set(cx + Math.cos(introCam.a) * introCam.r, introCam.h, cz + Math.sin(introCam.a) * introCam.r);
    camera.lookAt(cx, 10, cz);
  } else {
    updatePlayer(dt);
  }
  updateHighlight();
  renderer.render(scene, camera);

  // fps + pos
  fpsAcc += dt; fpsN++;
  if ((fpsT += dt) > 0.5) {
    $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    $('pos').textContent = `${Math.floor(player.pos.x - OX)}, ${Math.floor(player.pos.y)}, ${Math.floor(player.pos.z - OZ)}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
