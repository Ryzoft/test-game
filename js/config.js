/* ============================================================
   PULSE DASH — config.js
   Global constants, tuning values and per-level visual themes.
   ============================================================ */
'use strict';

const CFG = {
  // Canvas / world
  W: 1280,
  H: 720,
  B: 48,               // block size in px
  GROUND: 624,         // y of the floor surface (13 blocks of playfield)
  CEIL: 48,            // y of the ceiling surface (ship / flipped gravity)
  CAM_X: 400,          // player screen-x offset

  // Player
  PLAYER: 44,          // visual + solid hitbox size
  INNER: 20,           // forgiving inner hitbox vs spikes / saws

  // Cube physics (px/s, px/s^2)
  GRAVITY: 5400,
  JUMP_V: 1040,
  ROT_SPEED: 486,      // deg/s while airborne (~180 deg per jump)

  // Ship physics
  SHIP_ACCEL: 3800,
  SHIP_MAXV: 620,

  // Run speeds (px/s)  — roughly GD slow / normal / fast
  SPEEDS: { slow: 415, normal: 500, fast: 625 },

  // Interactables
  PAD_YELLOW_V: 1350,
  PAD_PINK_V: 950,
  ORB_YELLOW_V: 1040,
  ORB_PINK_V: 820,
  ORB_RADIUS: 44,      // generous activation radius
  INPUT_BUFFER: 0.10,  // s — a press this recent still counts

  // Feel
  RESPAWN_DELAY: 0.7,
  CHECKPOINT_EVERY: 1.5,
  PRACTICE_HINT_DEATHS: 8,
};

/* Per-level visual themes -------------------------------------------- */
const THEMES = [
  { // 0 — Stereo Sunrise
    name: 'sunrise',
    bgTop: '#12082e', bgBot: '#4a1259',
    sun: ['#ff9d3f', '#ff2d78'],
    far: '#2a0f4d', mid: '#3d1566', near: '#571d80',
    line: '#ff9d3f', grid: 'rgba(255,157,63,0.16)',
    block: '#1b0f38', blockEdge: '#ff7bd5',
    spike: '#241147', spikeEdge: '#ffb45e',
    player: '#3fe0ff', player2: '#ffe14d',
    floorGlow: 'rgba(255,120,60,0.25)',
  },
  { // 1 — Neon Overdrive
    name: 'neon',
    bgTop: '#050a24', bgBot: '#121f5c',
    sun: ['#31e8ff', '#7a5cff'],
    far: '#0b1440', mid: '#122060', near: '#1b2f8a',
    line: '#31e8ff', grid: 'rgba(49,232,255,0.14)',
    block: '#0a1233', blockEdge: '#31e8ff',
    spike: '#101a45', spikeEdge: '#ff4dd8',
    player: '#5dff7f', player2: '#31e8ff',
    floorGlow: 'rgba(49,180,255,0.25)',
  },
  { // 2 — Hyper Voltage
    name: 'voltage',
    bgTop: '#160409', bgBot: '#4d0f14',
    sun: ['#ffd23f', '#ff3c2e'],
    far: '#2b070f', mid: '#3f0a14', near: '#5c101b',
    line: '#ffd23f', grid: 'rgba(255,210,63,0.13)',
    block: '#26070c', blockEdge: '#ff5b3c',
    spike: '#330a10', spikeEdge: '#ffd23f',
    player: '#ff9d3f', player2: '#ff3c6e',
    floorGlow: 'rgba(255,90,50,0.25)',
  },
];

/* Small helpers used everywhere -------------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Deterministic RNG so background decorations are stable per level.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
