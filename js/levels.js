/* ============================================================
   PULSE DASH — levels.js
   Level builder DSL (block coordinates) + 3 handcrafted levels.

   Conventions:
   - x is in blocks from level start, y in blocks above the ground
     (y=0 means "sitting on the floor"). 1 block = 48 px.
   - The ceiling sits exactly 12 blocks above the ground, so a
     ceiling-mounted column of height h uses y = 12 - h.
   - The builder keeps a cursor `this.x`; plain methods advance it,
     `*At(dx, ...)` methods place relative to the cursor without
     advancing.

   Feasibility cheat-sheet (see js/config.js):
   - Cube jump: ~4.0 blocks of air distance, apex ~2.08 blocks
     (at fast speed the same airtime covers ~5 blocks).
   - +1 block climbs are easy; +2 climbs are frame-perfect — avoid.
   - Yellow pad: apex ~3.5 blocks, ~5.2 blocks of air distance.
   - Ship corridors: keep >= 3 blocks tall, obstacles >= 5 apart.
   ============================================================ */
'use strict';

class LevelBuilder {
  constructor(meta) {
    this.meta = meta;
    this.o = [];
    this.x = 0;
  }
  /* px helpers */
  px(xBlocks) { return xBlocks * CFG.B; }
  topY(yBlocks, hBlocks) { return CFG.GROUND - (yBlocks + hBlocks) * CFG.B; }

  gap(n) { this.x += n; return this; }

  /* ground/elevated spikes. dir 'up' points up, 'down' hangs pointing down */
  spike(n = 1, y = 0, dir = 'up') {
    for (let i = 0; i < n; i++) this.spikeAt(i, y, dir);
    this.x += n;
    return this;
  }
  spikeAt(dx, y = 0, dir = 'up') {
    this.o.push({ t: 'spike', x: this.px(this.x + dx), y: this.topY(y, 1), dir });
    return this;
  }

  /* solid column, bottom edge at height y, h blocks tall, w wide */
  block(w = 1, h = 1, y = 0) { this.blockAt(0, w, h, y); this.x += w; return this; }
  blockAt(dx, w, h, y = 0) {
    this.o.push({ t: 'block', x: this.px(this.x + dx), y: this.topY(y, h),
                  w: w * CFG.B, h: h * CFG.B });
    return this;
  }
  /* column hanging from the ceiling, h blocks tall */
  ceilAt(dx, w, h) { return this.blockAt(dx, w, h, 12 - h); }

  /* thin one-way platform whose top surface is y blocks up */
  platAt(dx, w, y) {
    this.o.push({ t: 'plat', x: this.px(this.x + dx), y: this.topY(y, 0),
                  w: w * CFG.B });
    return this;
  }

  padAt(dx, kind, y = 0) {
    this.o.push({ t: 'pad', x: this.px(this.x + dx), y: this.topY(y, 0), kind });
    return this;
  }
  orbAt(dx, y, kind) {
    this.o.push({ t: 'orb', x: this.px(this.x + dx) + CFG.B / 2,
                  y: this.topY(y, 0) - CFG.B / 2, kind });
    return this;
  }
  sawAt(dx, y, r = 0.9) {
    this.o.push({ t: 'saw', x: this.px(this.x + dx) + CFG.B / 2,
                  y: this.topY(y, 0), r: r * CFG.B });
    return this;
  }
  /* portal: 1x3 blocks tall capsule, center y blocks above ground */
  portal(kind, y = 1.5) {
    this.o.push({ t: 'portal', x: this.px(this.x) + CFG.B / 2,
                  y: this.topY(y, 0), kind });
    this.x += 2;
    return this;
  }
  coinAt(dx, y) {
    this.o.push({ t: 'coin', x: this.px(this.x + dx) + CFG.B / 2,
                  y: this.topY(y, 0) - CFG.B / 2, id: this._coin = (this._coin || 0) + 1 });
    return this;
  }

  build(endPad = 14) {
    this.o.sort((a, b) => a.x - b.x);
    return { meta: this.meta, objects: this.o, lengthPx: this.px(this.x + endPad) };
  }
}

/* ================================================================
   LEVEL 1 — "Stereo Sunrise"  (Easy · normal speed · 128 BPM)
   Teaches: jumps, doubles, blocks, pads, orbs, platforms,
   gravity portals, ship mode. Gentle spacing throughout.
   ================================================================ */
function buildLevel1() {
  const L = new LevelBuilder({
    id: 0, name: 'Stereo Sunrise', difficulty: 'EASY',
    theme: 0, speed: 'normal', stars: 2,
  });

  // -- warm-up singles, on the beat
  L.gap(12).spike();          // 12
  L.gap(7).spike();           // 20
  L.gap(6).spike();           // 27
  L.gap(6).spike();           // 34

  // -- doubles
  L.gap(9).spike(2);          // 44
  L.gap(8).spike(2);          // 54
  L.gap(8).spike(2);          // 64

  // -- block staircase (all +1 climbs)
  L.gap(8);                   // 72
  L.block(3, 1);              // 72..75, top y1
  L.gap(2);                   // spike-free landing gap
  L.block(3, 2);              // 77..80, +1 climb
  L.gap(2);
  L.block(3, 3);              // 82..85, +1 climb
  L.gap(3).spike();           // 88 — hop it after dropping down

  // -- yellow pad launch over a 3-spike bed
  L.gap(8);                   // 97
  L.padAt(0, 'yellow');
  L.gap(2).spike(3);          // spikes 99..102, pad flight lands ~102.2
  L.coinAt(-1.5, 3.2);        // coin 1: grab it at the top of the pad arc

  // -- orb tutorial: field is jumpable, orb makes it stylish
  L.gap(10);                  // 112
  L.spike(3);                 // 112..115
  L.orbAt(-1.5, 1.6, 'yellow');

  // -- platform hops over a long spike bed
  L.gap(10);                  // 125
  L.block(1, 1);              // step up
  L.spikeAt(0, 0); L.spikeAt(1, 0); L.spikeAt(2, 0); L.spikeAt(3, 0);
  L.spikeAt(4, 0); L.spikeAt(5, 0); L.spikeAt(6, 0); L.spikeAt(7, 0);
  L.spikeAt(8, 0); L.spikeAt(9, 0);                 // bed 126..136
  L.platAt(0, 3, 2);          // plat 126..129 (from the step: +1)
  L.platAt(5, 3, 2);          // plat 131..134, 2-block gap
  L.gap(12);                  // 138 clear landing

  // -- gravity flip run on the ceiling
  L.gap(6);                   // 144
  L.portal('gravUp', 2);      // 144, cursor -> 146
  L.gap(10);                  // long fall to ceiling, keep clear
  L.spike(1, 11, 'down');     // 156
  L.gap(6).spike(1, 11, 'down');  // 163
  L.gap(6).spike(1, 11, 'down');  // 170
  L.gap(6);
  L.portal('gravDown', 10);   // 177, fall back to floor
  L.gap(10);                  // clear landing zone

  // -- breather doubles
  L.spike(2);                 // 191
  L.gap(8).spike(2);          // 201

  // -- ship intro: wide corridor, gentle weave
  L.gap(8);                   // 211
  L.portal('ship', 2);        // 211, cursor 213
  L.gap(6);                   // 219
  L.ceilAt(0, 2, 3);          // stalactite at 219
  L.gap(8);
  L.block(2, 3);              // floor column at 227
  L.gap(6);                   // 235
  L.ceilAt(0, 2, 4);
  L.coinAt(1, 2.0);           // coin 2: dip under the stalactite
  L.gap(8);
  L.block(2, 3);              // 243
  L.gap(6);                   // 251
  L.ceilAt(0, 2, 7);          // forces a low approach to the exit
  L.gap(4);
  L.portal('cube', 1.5);      // 257
  L.gap(8);

  // -- victory lap
  L.spike();                  // 267
  L.gap(7).spike(2);          // 276
  L.gap(8).spike();           // 285
  L.gap(6).coinAt(0, 0.2);    // coin 3: free — everyone gets one
  L.gap(10);

  return L.build();           // ~300 blocks
}

/* ================================================================
   LEVEL 2 — "Neon Overdrive"  (Normal · 140 BPM)
   Adds: saws, speed portals, tighter gravity play, real orb chains.
   ================================================================ */
function buildLevel2() {
  const L = new LevelBuilder({
    id: 1, name: 'Neon Overdrive', difficulty: 'NORMAL',
    theme: 1, speed: 'normal', stars: 5,
  });

  // -- straight into doubles
  L.gap(12).spike(2);         // 14
  L.gap(7).spike(2);          // 23
  L.gap(7).spike(2);          // 32

  // -- saw hops
  L.gap(8);                   // 40
  L.sawAt(0, 0.9); L.gap(7);  // 47
  L.sawAt(0, 0.9); L.gap(7);  // 54
  L.sawAt(0, 1.1); L.gap(8);  // 62

  // -- stairs with a spike in the gap
  L.block(3, 1);              // 62..65
  L.spikeAt(1, 0);            // ground spike at 66
  L.gap(3);
  L.block(3, 2);              // 68..71 (+1 over the spike)
  L.spikeAt(1, 2);            // spike on top at 72 — hop it
  L.gap(4).spike(2);          // land, doubles at 75

  // -- orb chain over a long pit
  L.gap(8);                   // 85
  L.spike(10);                // 85..95
  L.orbAt(-7.5, 2.0, 'yellow');
  L.orbAt(-3.5, 2.4, 'yellow');
  L.coinAt(-5.5, 4.4);        // coin 1: above the chain — tap high
  L.gap(6);

  // -- gravity volley
  L.portal('gravUp', 2);      // 101
  L.gap(9);
  L.spike(2, 11, 'down');     // 112
  L.gap(7).spike(2, 11, 'down'); // 121
  L.gap(6);
  L.portal('gravDown', 10);   // 129
  L.gap(9);

  // -- speed up! singles then doubles at fast speed (jump covers ~5)
  L.portal('fast', 1.5);      // 140
  L.gap(8).spike();           // 150
  L.gap(8).spike();           // 159
  L.gap(8).spike(2);          // 169
  L.gap(9).spike(2);          // 180
  L.gap(9).spike(3);          // 192 — a triple is fair at fast speed
  L.gap(9);
  L.portal('normal', 1.5);    // 204
  L.gap(8);

  // -- ship weave, height-4 corridor
  L.portal('ship', 2);        // 214
  L.gap(6);
  L.ceilAt(0, 2, 5);          // 222
  L.gap(6);
  L.block(2, 4);              // 230
  L.gap(6);
  L.ceilAt(0, 2, 6);          // 238
  L.coinAt(1, 1.6);           // coin 2: hug the floor under it
  L.gap(6);
  L.block(2, 5);              // 246
  L.gap(6);
  L.ceilAt(0, 2, 5); L.blockAt(0, 2, 2, 0); // 254: pinch, gap y2..y7
  L.gap(7);
  L.portal('cube', 1.5);      // 263
  L.gap(8);

  // -- pad + orb finale
  L.padAt(0, 'yellow');       // 273
  L.gap(2).spike(4);          // bed 275..279, pad lands ~278.2 — tap nothing
  L.gap(8).spike(3);          // 289 triple...
  L.orbAt(-1.5, 1.8, 'yellow');  // ...with an orb to make it honest
  L.gap(8).spike(2);          // 300
  L.gap(7).spike(2);          // 309
  L.coinAt(4, 0.2);           // coin 3: on the run home
  L.gap(12);

  return L.build();           // ~325 blocks
}

/* ================================================================
   LEVEL 3 — "Hyper Voltage"  (Hard · fast speed · 150 BPM)
   Fast from frame one. Tight rhythm, gravity spam, ship gauntlet.
   Jump covers ~5 blocks at this speed.
   ================================================================ */
function buildLevel3() {
  const L = new LevelBuilder({
    id: 2, name: 'Hyper Voltage', difficulty: 'HARD',
    theme: 2, speed: 'fast', stars: 8,
  });

  // -- rapid-fire singles
  L.gap(12).spike();          // 12
  L.gap(6).spike();           // 19
  L.gap(6).spike();           // 26
  L.gap(5).spike();           // 32
  L.gap(5).spike();           // 38

  // -- triples (fair at fast speed) and a quad with an orb
  L.gap(8).spike(3);          // 49
  L.gap(8).spike(3);          // 60
  L.gap(8).spike(4);          // 71..75
  L.orbAt(-2, 1.8, 'yellow');
  L.gap(8);

  // -- saw pressure lane: floating saws look scary, hitboxes are fair
  L.spike(); L.sawAt(0, 3.9, 1.0);  // 83
  L.gap(7).spike(); L.sawAt(0, 3.9, 1.0);  // 91
  L.gap(7).spike(2); L.sawAt(0.5, 4.1, 1.1); // 99
  L.gap(9);

  // -- gravity spam
  L.portal('gravUp', 2);      // 110
  L.gap(8);
  L.spike(2, 11, 'down');     // 120
  L.gap(7).spike(2, 11, 'down'); // 129
  L.gap(6);
  L.portal('gravDown', 10);   // 137
  L.gap(8);
  L.spike(2);                 // 147
  L.gap(7);
  L.portal('gravUp', 2);      // 156
  L.gap(8);
  L.spike(1, 11, 'down'); L.sawAt(0, 8.4, 1.0); // 166
  L.gap(7).spike(2, 11, 'down'); // 174
  L.gap(6);
  L.portal('gravDown', 10);   // 182
  L.gap(9);

  // -- breather + coin
  L.spike(2);                 // 193
  L.coinAt(-1, 3.4);          // coin 1: apex of the double-spike jump
  L.gap(9);

  // -- ship gauntlet: 3.5-high weave
  L.portal('ship', 2);        // 204
  L.gap(6);
  L.ceilAt(0, 2, 5);          // 212
  L.gap(5);
  L.block(2, 4);              // 219
  L.gap(5);
  L.ceilAt(0, 2, 6);          // 226
  L.gap(5);
  L.block(2, 5);              // 233
  L.gap(5);
  L.ceilAt(0, 2, 7);          // 240 — low squeeze
  L.coinAt(1, 1.5);           // coin 2: in the squeeze
  L.gap(5);
  L.block(2, 5);              // 247
  L.gap(5);
  L.ceilAt(0, 2, 5); L.blockAt(0, 2, 3, 0); // 254 pinch: gap y3..y7
  L.gap(6);
  L.block(2, 4);              // 262
  L.gap(6);
  L.portal('cube', 1.5);      // 270
  L.gap(8);

  // -- pad vault over saw field
  L.padAt(0, 'yellow');       // 280
  L.sawAt(2.5, 0.6, 0.9); L.sawAt(4.5, 0.6, 0.9); // land ~286.5 at fast
  L.gap(10);

  // -- the wall: rhythm finale
  L.spike(2);                 // 292
  L.gap(7).spike(2);          // 301
  L.gap(7).spike(3);          // 310
  L.gap(8).spike(2);          // 321
  L.gap(7).spike(3);          // 330
  L.orbAt(-1.5, 1.8, 'yellow');
  L.gap(8).spike(2);          // 341
  L.coinAt(5, 0.2);           // coin 3: run it home
  L.gap(12);

  return L.build();           // ~355 blocks @ 13 blocks/s
}

const LEVELS = [buildLevel1, buildLevel2, buildLevel3];
