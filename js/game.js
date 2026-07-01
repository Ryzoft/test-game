/* ============================================================
   PULSE DASH — game.js
   Engine: fixed-timestep physics, collisions, game states,
   rendering (parallax, beat-synced glow), practice mode,
   autoplay menu demo, HUD wiring and save data.
   ============================================================ */
'use strict';

(() => {
  const canvas = document.getElementById('game');
  const g = canvas.getContext('2d');
  const STEP = 1 / 240;             // physics substep
  const PS = CFG.PLAYER, HW = PS / 2;

  /* =========================== save =========================== */
  const SAVE_KEY = 'pulse-dash-v1';
  let save = { muted: false, levels: {} };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.levels) save = s;
  } catch (e) { /* private mode etc. — play without saving */ }
  function levelSave(id) {
    if (!save.levels[id]) save.levels[id] = { best: 0, coins: [false, false, false], attempts: 0, wins: 0 };
    return save.levels[id];
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }

  /* =========================== input ========================== */
  const input = { held: false, pressedAt: -1e9, now: 0 };
  function press() {
    input.held = true;
    input.pressedAt = input.now;
    AudioSys.ensure();
  }
  function release() { input.held = false; }
  function consumePress() { input.pressedAt = -1e9; }
  function pressBuffered() { return input.now - input.pressedAt < CFG.INPUT_BUFFER; }

  /* ======================= run construction =================== */
  // A "run" is one live playthrough (the menu demo is a second run).
  function makeRun(levelIndex, demo) {
    const level = LEVELS[levelIndex]();
    const th = THEMES[level.meta.theme];
    return {
      demo, level, th,
      gateX: level.lengthPx - 5 * CFG.B,
      objects: level.objects,
      winStart: 0, winEnd: 0,       // active object window indices
      player: null,
      camX: 0,
      time: 0, attemptTime: 0, jumps: 0,
      attemptNum: 0, attemptTextX: 0,
      sessionCoins: [false, false, false],
      deaths: 0, dead: false, deadT: 0, won: false, wonT: 0,
      practice: false, checkpoints: [], ckptTimer: 0,
      flash: 0, flashColor: '#fff',
      deco: makeDeco(level, levelIndex),
      finished: false,
    };
  }

  function spawnPlayer(R, ck) {
    R.player = ck ? {
      x: ck.x, y: ck.y, vy: ck.vy, grav: ck.grav, mode: ck.mode,
      speedKey: ck.speedKey,
      rot: 0, rotSnap: 0, grounded: false, squash: 0,
    } : {
      x: -5 * CFG.B, y: CFG.GROUND - HW, vy: 0, grav: 1, mode: 'cube',
      speedKey: R.level.meta.speed,
      rot: 0, rotSnap: 0, grounded: true, squash: 0,
    };
    R.dead = false; R.deadT = 0;
    R.attemptTime = 0;
    R.winStart = 0; R.winEnd = 0;   // window only advances — rewind it on spawn
    for (const o of R.objects) o.used = false;
    if (!ck) R.sessionCoins = [false, false, false];
    R.attemptNum++;
    R.attemptTextX = R.player.x;
    if (!R.demo) {
      const ls = levelSave(R.level.meta.id);
      ls.attempts++;
      persist();
    }
    consumePress();
  }

  /* ========================= game state ======================= */
  let state = 'menu';               // menu | select | play | pause | win
  let run = null;                   // active play run
  let demoRun = null;               // background attract-mode run
  let toastTimer = null;

  /* ========================= physics ========================== */
  function speedOf(p) { return CFG.SPEEDS[p.speedKey]; }

  function jump(R, p) {
    p.vy = -CFG.JUMP_V * p.grav;
    p.grounded = false;
    p.squash = -0.18;               // stretch
    R.jumps++;
    consumePress();
    if (!R.demo) AudioSys.sfx.jump();
  }

  function land(R, p) {
    if (!p.grounded) {
      p.squash = 0.22;              // squash on impact
      p.rotSnap = Math.round(p.rot / 90) * 90;
      if (!R.demo) FX.dust(p.x, p.y + HW * p.grav, p.grav);
    }
    p.grounded = true;
  }

  function kill(R, p) {
    if (R.dead || R.won) return;
    R.dead = true; R.deadT = 0; R.deaths++;
    FX.explode(p.x, p.y, R.th.player, R.th.player2);
    if (!R.demo) {
      AudioSys.sfx.death();
      const ls = levelSave(R.level.meta.id);
      const pct = percentOf(R);
      if (pct > ls.best) { ls.best = pct; persist(); }
      if (R.deaths === CFG.PRACTICE_HINT_DEATHS && !R.practice)
        toast('Struggling? Open pause (ESC) and enable PRACTICE MODE for checkpoints.');
    } else {
      FX.shake(0);                  // keep the menu calm
    }
  }

  function winRun(R, p) {
    if (R.won) return;
    R.won = true; R.wonT = 0;
    FX.confettiBurst(p.x, p.y);
    FX.ring(p.x, p.y, 20, 700, 0.8, '#ffffff', 5);
    if (!R.demo) {
      AudioSys.sfx.win();
      const ls = levelSave(R.level.meta.id);
      ls.best = 100; ls.wins++;
      for (let i = 0; i < 3; i++) ls.coins[i] = ls.coins[i] || R.sessionCoins[i];
      persist();
    }
  }

  function percentOf(R) {
    return clamp(Math.floor(R.player.x / R.gateX * 100), 0, 100);
  }

  /* ---- object window: only collide/draw what's near the camera */
  function updateWindow(R) {
    const lo = R.player.x - 300, hi = R.player.x + CFG.W + 300;
    const o = R.objects;
    while (R.winStart < o.length && o[R.winStart].x + (o[R.winStart].w || 200) < lo) R.winStart++;
    if (R.winEnd < R.winStart) R.winEnd = R.winStart;
    while (R.winEnd < o.length && o[R.winEnd].x < hi) R.winEnd++;
  }

  function stepPhysics(R, dt) {
    const p = R.player;
    const prevY = p.y;

    // horizontal
    p.x += speedOf(p) * dt;

    // vertical
    if (p.mode === 'ship') {
      const dir = input.held && !R.demo ? -1 : (R.demo && demoBotHold(R) ? -1 : 1);
      p.vy += CFG.SHIP_ACCEL * dir * p.grav * dt;
      p.vy = clamp(p.vy, -CFG.SHIP_MAXV, CFG.SHIP_MAXV);
    } else {
      p.vy += CFG.GRAVITY * p.grav * dt;
    }
    p.y += p.vy * dt;

    p.grounded = false;

    // ground plane (always solid)
    if (p.y + HW >= CFG.GROUND && p.vy >= 0) {
      p.y = CFG.GROUND - HW; p.vy = 0;
      if (p.grav === 1 || p.mode === 'ship') land(R, p);
    }
    // ceiling plane (solid for ship / reversed gravity)
    if ((p.mode === 'ship' || p.grav === -1) && p.y - HW <= CFG.CEIL && p.vy <= 0) {
      p.y = CFG.CEIL + HW; p.vy = 0;
      if (p.grav === -1 || p.mode === 'ship') land(R, p);
    }

    // objects
    for (let i = R.winStart; i < R.winEnd; i++) {
      const o = R.objects[i];
      switch (o.t) {
        case 'block':  collideBlock(R, p, o, prevY); break;
        case 'plat':   collidePlat(R, p, o, prevY); break;
        case 'spike':  collideSpike(R, p, o); break;
        case 'saw':    collideSaw(R, p, o); break;
        case 'pad':    collidePad(R, p, o); break;
        case 'orb':    collideOrb(R, p, o); break;
        case 'portal': collidePortal(R, p, o); break;
        case 'coin':   collideCoin(R, p, o); break;
      }
      if (R.dead) return;
    }

    // cube: buffered / held jumping
    if (p.mode === 'cube' && p.grounded && !R.dead) {
      const wantJump = R.demo ? demoBotJump(R) : (input.held || pressBuffered());
      if (wantJump) jump(R, p);
    }

    // rotation
    if (p.mode === 'cube') {
      if (!p.grounded) p.rot += CFG.ROT_SPEED * dt * p.grav;
      else p.rot = lerp(p.rot, p.rotSnap, Math.min(1, 28 * dt));
    } else {
      p.rot = clamp(p.vy * 0.045, -32, 32) * p.grav;
    }
    p.squash = lerp(p.squash, 0, Math.min(1, 12 * dt));

    // finish gate
    if (p.x >= R.gateX && !R.won) winRun(R, p);
  }

  /* ---- collisions ---- */
  function overlapsPlayer(p, x, y, w, h, inner) {
    const r = inner ? CFG.INNER / 2 : HW;
    return p.x + r > x && p.x - r < x + w && p.y + r > y && p.y - r < y + h;
  }

  function collideBlock(R, p, o, prevY) {
    if (!overlapsPlayer(p, o.x, o.y, o.w, o.h, false)) return;
    const top = o.y, bot = o.y + o.h;
    const prevBottom = prevY + HW, prevTop = prevY - HW;
    if (p.grav === 1) {
      if (p.vy >= 0 && prevBottom <= top + 8) { p.y = top - HW; p.vy = 0; land(R, p); return; }
      if (p.mode === 'ship' && p.vy <= 0 && prevTop >= bot - 8) { p.y = bot + HW; p.vy = 0; return; }
    } else {
      if (p.vy <= 0 && prevTop >= bot - 8) { p.y = bot + HW; p.vy = 0; land(R, p); return; }
      if (p.mode === 'ship' && p.vy >= 0 && prevBottom <= top + 8) { p.y = top - HW; p.vy = 0; return; }
    }
    kill(R, p);
  }

  function collidePlat(R, p, o, prevY) {
    if (p.grav !== 1 || p.vy < 0) return;
    if (p.x + HW <= o.x || p.x - HW >= o.x + o.w) return;
    const prevBottom = prevY + HW;
    if (prevBottom <= o.y + 8 && p.y + HW >= o.y) {
      p.y = o.y - HW; p.vy = 0; land(R, p);
    }
  }

  function collideSpike(R, p, o) {
    // forgiving core hitbox inside the 48px triangle
    const coreY = o.dir === 'up' ? o.y + 16 : o.y;
    if (overlapsPlayer(p, o.x + 15, coreY, 18, 32, true)) kill(R, p);
  }

  function collideSaw(R, p, o) {
    const dx = p.x - o.x, dy = p.y - o.y;
    const rr = o.r * 0.78 + CFG.INNER / 2;
    if (dx * dx + dy * dy < rr * rr) kill(R, p);
  }

  function collidePad(R, p, o) {
    if (o.used) return;
    if (!overlapsPlayer(p, o.x, o.y - 14, CFG.B, 16, false)) return;
    o.used = true;
    const v = o.kind === 'yellow' ? CFG.PAD_YELLOW_V : CFG.PAD_PINK_V;
    p.vy = -v * p.grav;
    p.grounded = false;
    R.jumps++;
    FX.ring(o.x + CFG.B / 2, o.y, 8, 480, 0.35, '#ffe14d', 4);
    if (!R.demo) AudioSys.sfx.pad();
  }

  function collideOrb(R, p, o) {
    if (o.used) return;
    const dx = p.x - o.x, dy = p.y - o.y;
    if (dx * dx + dy * dy > CFG.ORB_RADIUS * CFG.ORB_RADIUS) return;
    const want = R.demo ? demoBotOrb(R, o) : pressBuffered();
    if (!want) return;
    o.used = true;
    consumePress();
    R.jumps++;
    if (o.kind === 'blue') {
      p.grav *= -1;
      p.vy = 0.3 * CFG.JUMP_V * p.grav;
    } else {
      const v = o.kind === 'yellow' ? CFG.ORB_YELLOW_V : CFG.ORB_PINK_V;
      p.vy = -v * p.grav;
    }
    p.grounded = false;
    FX.ring(o.x, o.y, 12, 560, 0.4, orbColor(o.kind), 5);
    FX.sparkle(o.x, o.y, orbColor(o.kind));
    if (!R.demo) AudioSys.sfx.orb();
  }

  function collidePortal(R, p, o) {
    if (o.used) return;
    if (!overlapsPlayer(p, o.x - 24, o.y - 72, 48, 144, false)) return;
    o.used = true;
    switch (o.kind) {
      case 'gravUp':   if (p.grav !== -1) { p.grav = -1; p.vy *= 0.4; } break;
      case 'gravDown': if (p.grav !== 1) { p.grav = 1; p.vy *= 0.4; } break;
      case 'ship':     p.mode = 'ship'; p.vy *= 0.4; break;
      case 'cube':     p.mode = 'cube'; break;
      case 'fast':     p.speedKey = 'fast'; break;
      case 'normal':   p.speedKey = 'normal'; break;
      case 'slow':     p.speedKey = 'slow'; break;
    }
    R.flash = 0.5; R.flashColor = portalColor(o.kind);
    FX.ring(o.x, o.y, 30, 800, 0.5, portalColor(o.kind), 6);
    if (!R.demo) AudioSys.sfx.portal();
  }

  function collideCoin(R, p, o) {
    const idx = o.id - 1;
    if (R.sessionCoins[idx]) return;
    const dx = p.x - o.x, dy = p.y - o.y;
    if (dx * dx + dy * dy > 44 * 44) return;
    R.sessionCoins[idx] = true;
    FX.sparkle(o.x, o.y, '#ffd23f');
    FX.ring(o.x, o.y, 10, 420, 0.4, '#ffd23f', 4);
    if (!R.demo) { AudioSys.sfx.coin(); refreshCoinDots(R); }
  }

  /* ==================== demo bot (attract mode) ================ */
  function hazardAhead(R, from, to) {
    for (let i = R.winStart; i < R.winEnd; i++) {
      const o = R.objects[i];
      if (o.x < from || o.x > to) continue;
      if (o.t === 'spike' && o.dir === 'up' && o.y > CFG.GROUND - 3 * CFG.B) return true;
      if (o.t === 'saw' && o.y > CFG.GROUND - 2.2 * CFG.B) return true;
      if (o.t === 'block' && o.y + o.h >= CFG.GROUND - 1 && o.y < CFG.GROUND - 4) return true;
    }
    return false;
  }
  function demoBotJump(R) {
    const p = R.player;
    if (p.grav === -1) {
      for (let i = R.winStart; i < R.winEnd; i++) {
        const o = R.objects[i];
        if (o.t === 'spike' && o.dir === 'down' && o.x > p.x + 20 && o.x < p.x + 120) return true;
      }
      return false;
    }
    return hazardAhead(R, p.x + 24, p.x + 128);
  }
  function demoBotHold(R) {
    const p = R.player;
    // fly toward the middle of the safe band, drop for low pinches
    let target = (CFG.GROUND + CFG.CEIL) / 2;
    for (let i = R.winStart; i < R.winEnd; i++) {
      const o = R.objects[i];
      if (o.t === 'block' && o.x > p.x - 40 && o.x < p.x + 260) {
        if (o.y <= CFG.CEIL + 4) target = Math.max(target, o.y + o.h + 90);       // stalactite: go low
        else target = Math.min(target, o.y - 90);                                  // floor column: go high
      }
      if (o.t === 'portal' && o.kind === 'cube' && o.x > p.x && o.x < p.x + 300) target = o.y;
    }
    return p.y > target;
  }
  function demoBotOrb(R, o) {
    return hazardAhead(R, R.player.x, o.x + 160);
  }

  /* ===================== practice checkpoints ================== */
  function maybeAutoCheckpoint(R, dt) {
    if (!R.practice || R.dead || R.won) return;
    const p = R.player;
    R.ckptTimer += dt;
    if (R.ckptTimer < CFG.CHECKPOINT_EVERY) return;
    if (!p.grounded || p.mode !== 'cube') return;
    if (hazardNear(R, p.x - 40, p.x + 180)) return;
    placeCheckpoint(R);
  }
  function hazardNear(R, from, to) {
    for (let i = R.winStart; i < R.winEnd; i++) {
      const o = R.objects[i];
      if (o.x + (o.w || 48) < from || o.x > to) continue;
      if (o.t === 'spike' || o.t === 'saw' || o.t === 'portal') return true;
    }
    return false;
  }
  function placeCheckpoint(R) {
    const p = R.player;
    R.ckptTimer = 0;
    R.checkpoints.push({ x: p.x, y: p.y, vy: p.vy, grav: p.grav, mode: p.mode, speedKey: p.speedKey });
    if (R.checkpoints.length > 20) R.checkpoints.shift();
    AudioSys.sfx.checkpoint();
  }

  /* ========================== update =========================== */
  function updateRun(R, dt) {
    R.time += dt;
    input.now = R.time;             // buffer timing rides the run clock

    if (R.won) {
      R.wonT += dt;
      if (!R.demo && !R.finished && R.wonT > 1.1) { R.finished = true; showWin(R); }
      if (R.demo && R.wonT > 2) restartRun(R);
      FX.update(dt);
      return;
    }

    if (R.dead) {
      R.deadT += dt;
      const delay = R.demo ? 0.45 : CFG.RESPAWN_DELAY;
      if (R.deadT >= delay) {
        const ck = R.practice && R.checkpoints.length
          ? R.checkpoints[R.checkpoints.length - 1] : null;
        spawnPlayer(R, ck);
      }
      FX.update(dt);
      return;
    }

    R.attemptTime += dt;
    let acc = dt;
    while (acc > 1e-6 && !R.dead && !R.won) {
      const h = Math.min(STEP, acc);
      updateWindow(R);
      stepPhysics(R, h);
      acc -= h;
    }
    maybeAutoCheckpoint(R, dt);

    // trail
    const p = R.player;
    if (!R.dead) {
      FX.trail(p.x - HW * 0.6, p.y, R.th.player2);
      if (p.mode === 'ship' && input.held && !R.demo)
        FX.dust(p.x - HW, p.y + 10 * p.grav, p.grav);
    }
    R.camX = p.x - CFG.CAM_X;
    R.flash = Math.max(0, R.flash - dt * 2.2);
    FX.update(dt);
  }

  function restartRun(R, keepCheckpoints) {
    if (!keepCheckpoints) R.checkpoints.length = 0;
    R.winStart = 0; R.winEnd = 0;
    R.won = false; R.wonT = 0; R.finished = false;
    spawnPlayer(R, null);
  }

  /* ====================== deco generation ===================== */
  function makeDeco(level, seed) {
    const rnd = mulberry32(1234 + seed * 999);
    const span = level.lengthPx + 4000;
    const far = [], mid = [], stars = [];
    for (let x = -1200; x < span; x += 90 + rnd() * 160)
      far.push({ x, w: 130 + rnd() * 260, h: 90 + rnd() * 200 });
    for (let x = -1200; x < span; x += 140 + rnd() * 240)
      mid.push({ x, w: 60 + rnd() * 120, h: 140 + rnd() * 300, win: rnd() });
    for (let i = 0; i < 90; i++)
      stars.push({ x: rnd() * CFG.W, y: rnd() * CFG.H * 0.65, s: 0.6 + rnd() * 1.8, tw: rnd() * 6 });
    return { far, mid, stars };
  }

  /* ========================== render =========================== */
  function orbColor(kind) {
    return kind === 'yellow' ? '#ffe14d' : kind === 'pink' ? '#ff7bd5' : '#31e8ff';
  }
  function portalColor(kind) {
    return { gravUp: '#ffe14d', gravDown: '#31a8ff', ship: '#c05dff', cube: '#5dff7f',
             fast: '#ff5b3c', normal: '#31e8ff', slow: '#ff9d3f' }[kind] || '#fff';
  }

  function render(R, dim) {
    const th = R.th, p = R.player;
    const pulse = AudioSys.beatPulse();
    const [shx, shy] = R.demo ? [0, 0] : FX.shakeOffset();

    // --- sky
    const grad = g.createLinearGradient(0, 0, 0, CFG.H);
    grad.addColorStop(0, th.bgTop);
    grad.addColorStop(1, th.bgBot);
    g.fillStyle = grad;
    g.fillRect(0, 0, CFG.W, CFG.H);

    // stars
    g.save();
    for (const s of R.deco.stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(R.time * 1.5 + s.tw));
      g.globalAlpha = tw * 0.8;
      g.fillStyle = '#ffffff';
      const sx = ((s.x - R.camX * 0.05) % CFG.W + CFG.W) % CFG.W;
      g.fillRect(sx, s.y, s.s, s.s);
    }
    g.restore();

    // sun with pulse halo
    const sunX = CFG.W * 0.72 - ((R.camX * 0.03) % 300), sunY = 210;
    const sr = 95 + pulse * 10;
    const sun = g.createRadialGradient(sunX, sunY, 10, sunX, sunY, sr * 2.4);
    sun.addColorStop(0, th.sun[0]);
    sun.addColorStop(0.45, th.sun[1] + 'cc');
    sun.addColorStop(1, 'transparent');
    g.fillStyle = sun;
    g.fillRect(sunX - sr * 2.4, sunY - sr * 2.4, sr * 4.8, sr * 4.8);
    g.fillStyle = th.sun[0];
    g.beginPath(); g.arc(sunX, sunY, sr * 0.55, 0, Math.PI * 2); g.fill();
    g.fillStyle = th.bgTop;
    for (let i = 0; i < 4; i++)
      g.fillRect(sunX - sr, sunY - sr * 0.35 + i * 16, sr * 2, 5);

    // --- parallax silhouettes
    drawLayer(R, R.deco.far, 0.18, th.far, 0);
    drawLayer(R, R.deco.mid, 0.42, th.mid, 1);

    g.save();
    g.translate(-R.camX + shx, shy);

    // --- floor
    const gy = CFG.GROUND;
    g.fillStyle = th.near;
    g.fillRect(R.camX - 50, gy, CFG.W + 100, CFG.H - gy);
    g.fillStyle = th.floorGlow;
    g.fillRect(R.camX - 50, gy, CFG.W + 100, 14 + pulse * 10);
    g.strokeStyle = th.line;
    g.lineWidth = 3 + pulse * 2.5;
    g.shadowColor = th.line; g.shadowBlur = 14 + pulse * 16;
    g.beginPath(); g.moveTo(R.camX - 50, gy); g.lineTo(R.camX + CFG.W + 50, gy); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = th.grid;
    g.lineWidth = 1;
    const gx0 = Math.floor((R.camX - 50) / CFG.B) * CFG.B;
    g.beginPath();
    for (let x = gx0; x < R.camX + CFG.W + 50; x += CFG.B) {
      g.moveTo(x, gy); g.lineTo(x, CFG.H);
    }
    g.stroke();

    // --- ceiling (ship / flipped gravity)
    if (p && (p.mode === 'ship' || p.grav === -1)) {
      g.fillStyle = th.near;
      g.fillRect(R.camX - 50, 0, CFG.W + 100, CFG.CEIL);
      g.strokeStyle = th.line;
      g.lineWidth = 3;
      g.shadowColor = th.line; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(R.camX - 50, CFG.CEIL); g.lineTo(R.camX + CFG.W + 50, CFG.CEIL); g.stroke();
      g.shadowBlur = 0;
    }

    // --- attempt text
    if (!R.demo) {
      g.font = "700 44px 'Orbitron', sans-serif";
      g.textAlign = 'center';
      g.fillStyle = th.line;
      g.globalAlpha = 0.85;
      g.fillText(`ATTEMPT  ${levelSave(R.level.meta.id).attempts}`, R.attemptTextX + 60, CFG.GROUND - 170);
      g.globalAlpha = 1;
    }

    // --- checkpoints
    for (const c of R.checkpoints) drawDiamond(c.x, c.y, '#5dff7f');

    // --- objects
    for (let i = R.winStart; i < R.winEnd; i++) drawObject(R, R.objects[i], pulse);

    // --- finish gate
    drawGate(R, pulse);

    // --- particles (world space)
    FX.draw(g);

    // --- player
    if (p && !R.dead) drawPlayer(R, p);

    g.restore();

    // --- portal flash
    if (R.flash > 0) {
      g.globalAlpha = R.flash * 0.35;
      g.fillStyle = R.flashColor;
      g.fillRect(0, 0, CFG.W, CFG.H);
      g.globalAlpha = 1;
    }

    if (dim) {
      g.fillStyle = 'rgba(5,4,18,0.72)';
      g.fillRect(0, 0, CFG.W, CFG.H);
    }
  }

  function drawLayer(R, arr, par, color, kind) {
    g.save();
    g.fillStyle = color;
    const off = R.camX * par;
    for (const b of arr) {
      const sx = b.x - off;
      if (sx + b.w < -40 || sx > CFG.W + 40) continue;
      if (kind === 0) { // mountains
        g.beginPath();
        g.moveTo(sx, CFG.GROUND);
        g.lineTo(sx + b.w / 2, CFG.GROUND - b.h);
        g.lineTo(sx + b.w, CFG.GROUND);
        g.closePath(); g.fill();
      } else {          // towers
        g.fillRect(sx, CFG.GROUND - b.h, b.w, b.h);
        if (b.win > 0.4) {
          g.save();
          g.fillStyle = R.th.line;
          g.globalAlpha = 0.25;
          for (let wy = CFG.GROUND - b.h + 14; wy < CFG.GROUND - 20; wy += 26)
            g.fillRect(sx + 8, wy, b.w - 16, 3);
          g.restore();
        }
      }
    }
    g.restore();
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawObject(R, o, pulse) {
    const th = R.th;
    switch (o.t) {
      case 'block': {
        g.fillStyle = th.block;
        g.fillRect(o.x, o.y, o.w, o.h);
        g.strokeStyle = th.blockEdge;
        g.lineWidth = 2.5;
        g.shadowColor = th.blockEdge; g.shadowBlur = 8 + pulse * 8;
        g.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
        g.shadowBlur = 0;
        g.globalAlpha = 0.14;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1;
        for (let x = o.x + CFG.B; x < o.x + o.w; x += CFG.B) {
          g.beginPath(); g.moveTo(x, o.y + 3); g.lineTo(x, o.y + o.h - 3); g.stroke();
        }
        for (let y = o.y + CFG.B; y < o.y + o.h; y += CFG.B) {
          g.beginPath(); g.moveTo(o.x + 3, y); g.lineTo(o.x + o.w - 3, y); g.stroke();
        }
        g.globalAlpha = 1;
        break;
      }
      case 'plat': {
        g.fillStyle = th.block;
        g.fillRect(o.x, o.y, o.w, 12);
        g.strokeStyle = th.blockEdge;
        g.lineWidth = 2.5;
        g.shadowColor = th.blockEdge; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(o.x + o.w, o.y); g.stroke();
        g.shadowBlur = 0;
        break;
      }
      case 'spike': {
        const s = CFG.B;
        g.fillStyle = th.spike;
        g.strokeStyle = th.spikeEdge;
        g.lineWidth = 2.5;
        g.shadowColor = th.spikeEdge; g.shadowBlur = 7 + pulse * 6;
        g.beginPath();
        if (o.dir === 'up') {
          g.moveTo(o.x + 2, o.y + s);
          g.lineTo(o.x + s / 2, o.y + 3);
          g.lineTo(o.x + s - 2, o.y + s);
        } else {
          g.moveTo(o.x + 2, o.y);
          g.lineTo(o.x + s / 2, o.y + s - 3);
          g.lineTo(o.x + s - 2, o.y);
        }
        g.closePath(); g.fill(); g.stroke();
        g.shadowBlur = 0;
        break;
      }
      case 'saw': {
        g.save();
        g.translate(o.x, o.y);
        g.rotate(performanceTime() * 5);
        g.fillStyle = th.spike;
        g.strokeStyle = th.spikeEdge;
        g.lineWidth = 2.5;
        g.shadowColor = th.spikeEdge; g.shadowBlur = 10;
        g.beginPath();
        const teeth = 10;
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const rr = i % 2 === 0 ? o.r : o.r * 0.72;
          g[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath(); g.fill(); g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = th.spikeEdge;
        g.beginPath(); g.arc(0, 0, o.r * 0.2, 0, Math.PI * 2); g.fill();
        g.restore();
        break;
      }
      case 'pad': {
        const c = o.kind === 'yellow' ? '#ffe14d' : '#ff7bd5';
        g.fillStyle = c;
        g.shadowColor = c; g.shadowBlur = 14 + pulse * 10;
        g.beginPath();
        g.ellipse(o.x + CFG.B / 2, o.y - 2, 20, 8, 0, Math.PI, 0);
        g.fill();
        g.shadowBlur = 0;
        break;
      }
      case 'orb': {
        const c = orbColor(o.kind);
        const rr = 16 + pulse * 3;
        g.save();
        g.globalAlpha = o.used ? 0.25 : 1;
        const halo = g.createRadialGradient(o.x, o.y, 2, o.x, o.y, 40);
        halo.addColorStop(0, c);
        halo.addColorStop(1, 'transparent');
        g.fillStyle = halo;
        g.globalCompositeOperation = 'lighter';
        g.fillRect(o.x - 40, o.y - 40, 80, 80);
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.beginPath(); g.arc(o.x, o.y, rr, 0, Math.PI * 2); g.stroke();
        g.fillStyle = c;
        g.beginPath(); g.arc(o.x, o.y, rr * 0.55, 0, Math.PI * 2); g.fill();
        g.restore();
        break;
      }
      case 'portal': {
        const c = portalColor(o.kind);
        g.save();
        g.strokeStyle = c;
        g.shadowColor = c; g.shadowBlur = 18 + pulse * 10;
        g.lineWidth = 5;
        roundRect(o.x - 22, o.y - 70, 44, 140, 22);
        g.stroke();
        g.globalAlpha = 0.25;
        g.fillStyle = c;
        roundRect(o.x - 22, o.y - 70, 44, 140, 22);
        g.fill();
        g.globalAlpha = 1;
        g.shadowBlur = 0;
        g.fillStyle = '#ffffff';
        g.font = "700 17px 'Orbitron', sans-serif";
        g.textAlign = 'center';
        const glyph = { gravUp: '▲', gravDown: '▼', ship: '✈', cube: '■', fast: '»', normal: '›', slow: '‹' }[o.kind] || '?';
        g.fillText(glyph, o.x, o.y + 6);
        g.restore();
        break;
      }
      case 'coin': {
        const idx = o.id - 1;
        const got = R.sessionCoins[idx];
        const perm = !R.demo && levelSave(R.level.meta.id).coins[idx];
        if (got) break;
        const sc = Math.abs(Math.cos(performanceTime() * 3));
        g.save();
        g.translate(o.x, o.y + Math.sin(performanceTime() * 2.4) * 4);
        g.scale(Math.max(0.14, sc), 1);
        g.strokeStyle = '#ffd23f';
        g.fillStyle = perm ? 'transparent' : '#ffd23f';
        g.lineWidth = 3;
        g.shadowColor = '#ffd23f'; g.shadowBlur = 12;
        g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2);
        if (!perm) g.fill();
        g.stroke();
        g.restore();
        break;
      }
    }
  }

  function drawGate(R, pulse) {
    const x = R.gateX;
    g.save();
    g.strokeStyle = '#ffffff';
    g.shadowColor = R.th.line; g.shadowBlur = 20 + pulse * 14;
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(x, CFG.CEIL); g.lineTo(x, CFG.GROUND); g.stroke();
    g.shadowBlur = 0;
    g.globalAlpha = 0.5 + pulse * 0.3;
    for (let y = CFG.CEIL; y < CFG.GROUND; y += 32) {
      g.fillStyle = (y / 32) % 2 ? '#ffffff' : R.th.line;
      g.fillRect(x + 4, y, 10, 16);
    }
    g.restore();
  }

  function drawDiamond(x, y, c) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.strokeStyle = c;
    g.lineWidth = 3;
    g.shadowColor = c; g.shadowBlur = 10;
    g.strokeRect(-9, -9, 18, 18);
    g.restore();
  }

  function drawPlayer(R, p) {
    const th = R.th;
    g.save();
    g.translate(p.x, p.y);
    if (p.mode === 'ship') {
      g.rotate(p.rot * Math.PI / 180);
      g.scale(1, p.grav);
      // hull
      g.fillStyle = th.player;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.shadowColor = th.player; g.shadowBlur = 16;
      g.beginPath();
      g.moveTo(-HW - 8, 10);
      g.quadraticCurveTo(-HW - 4, -14, 0, -16);
      g.quadraticCurveTo(HW + 10, -12, HW + 12, 6);
      g.lineTo(HW + 4, 12);
      g.closePath();
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // canopy
      g.fillStyle = th.player2;
      g.beginPath(); g.arc(4, -8, 9, 0, Math.PI * 2); g.fill();
    } else {
      g.rotate(p.rot * Math.PI / 180);
      const sq = p.squash;
      g.scale(1 + sq, 1 - sq);
      g.fillStyle = th.player;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.shadowColor = th.player; g.shadowBlur = 18;
      roundRect(-HW, -HW, PS, PS, 7);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // face
      g.fillStyle = th.player2;
      roundRect(-HW + 8, -HW + 8, PS - 16, PS - 16, 4);
      g.fill();
      g.fillStyle = '#0a0a1a';
      g.fillRect(-9, -7, 6, 11);
      g.fillRect(4, -7, 6, 11);
      g.fillRect(-7, 8, 15, 4);
    }
    g.restore();
  }

  let t0 = performance.now();
  function performanceTime() { return (performance.now() - t0) / 1000; }

  /* ====================== HUD / overlays ======================= */
  const $ = id => document.getElementById(id);
  const overlays = ['menu', 'select', 'hud', 'pause', 'win'];
  function show(...ids) {
    for (const o of overlays) $(o).classList.toggle('visible', ids.includes(o));
  }

  function toast(msg, ms = 3600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
  }

  function refreshHud(R) {
    const pct = percentOf(R);
    $('progress-fill').style.width = pct + '%';
    $('pct').textContent = pct + '%';
    const best = levelSave(R.level.meta.id).best;
    $('progress-best').style.left = best + '%';
    $('progress-best').style.display = best > 0 ? 'block' : 'none';
  }

  function refreshCoinDots(R) {
    const dots = $('coin-dots').children;
    for (let i = 0; i < 3; i++)
      dots[i].classList.toggle('got', !!R.sessionCoins[i]);
  }

  function buildCards() {
    const wrap = $('cards');
    wrap.innerHTML = '';
    LEVELS.forEach((build, i) => {
      const meta = build().meta;
      const ls = levelSave(meta.id);
      const card = document.createElement('button');
      card.className = 'card theme-' + meta.theme;
      const coins = ls.coins.map(c => `<span class="cdot ${c ? 'got' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="card-diff">${meta.difficulty}</div>
        <div class="card-name">${meta.name}</div>
        <div class="card-best"><div class="card-best-fill" style="width:${ls.best}%"></div></div>
        <div class="card-foot"><span>${ls.best}%${ls.wins ? ' ✓' : ''}</span><span class="cdots">${coins}</span></div>`;
      card.addEventListener('click', () => { AudioSys.sfx.click(); startLevel(i); });
      wrap.appendChild(card);
    });
  }

  function showWin(R) {
    state = 'win';
    const meta = R.level.meta;
    $('win-name').textContent = meta.name;
    $('st-attempts').textContent = levelSave(meta.id).attempts;
    $('st-jumps').textContent = R.jumps;
    $('st-time').textContent = R.time.toFixed(1) + 's';
    const dots = $('win-coins').children;
    const perm = levelSave(meta.id).coins;
    for (let i = 0; i < 3; i++)
      dots[i].classList.toggle('got', !!(R.sessionCoins[i] || perm[i]));
    $('btn-next').style.display = meta.id + 1 < LEVELS.length ? '' : 'none';
    show('win');
  }

  /* ======================= state changes ====================== */
  function startLevel(i) {
    run = makeRun(i, false);
    spawnPlayer(run, null);
    FX.clear();
    state = 'play';
    show('hud');
    refreshCoinDots(run);
    $('pause-title').textContent = run.level.meta.name;
    AudioSys.playTrack(run.level.meta.theme, 1);
    toast(run.level.meta.id === 0 ? 'SPACE / CLICK to jump — hold to keep hopping' : run.level.meta.name, 2600);
  }

  function toMenu() {
    state = 'menu';
    run = null;
    FX.clear();
    ensureDemo();
    show('menu');
    AudioSys.playTrack(0, 0.3);
  }

  function toSelect() {
    state = 'select';
    buildCards();
    show('select');
  }

  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause';
    $('btn-practice').textContent = run.practice ? 'PRACTICE MODE: ON' : 'PRACTICE MODE: OFF';
    show('hud', 'pause');
  }

  function resumeGame() {
    state = 'play';
    show('hud');
  }

  function ensureDemo() {
    if (!demoRun) {
      demoRun = makeRun(0, true);
      spawnPlayer(demoRun, null);
    }
  }

  /* ========================= events =========================== */
  function onDown(e) {
    if (e.type === 'keydown') {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) e.preventDefault();
      else if (e.code === 'Escape' || e.code === 'KeyP') {
        if (state === 'play') pauseGame();
        else if (state === 'pause') resumeGame();
        return;
      } else if (e.code === 'KeyR' && state === 'play') {
        restartRun(run, run.practice); return;
      } else if (e.code === 'KeyM') {
        $('btn-mute').textContent = AudioSys.toggleMute() ? '🔇' : '🔊'; return;
      } else if (e.code === 'KeyZ' && state === 'play' && run.practice && !run.dead) {
        placeCheckpoint(run); return;
      } else if (e.code === 'KeyX' && state === 'play' && run.practice) {
        run.checkpoints.pop(); return;
      } else return;
    }
    press();
  }
  function onUp(e) {
    if (e.type === 'keyup' && !['Space', 'ArrowUp', 'KeyW'].includes(e.code)) return;
    release();
  }

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); onDown(e); });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('blur', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  $('btn-start').addEventListener('click', () => { AudioSys.ensure(); AudioSys.sfx.click(); toSelect(); });
  $('btn-back').addEventListener('click', () => { AudioSys.sfx.click(); toMenu(); });
  $('btn-pause').addEventListener('click', pauseGame);
  $('btn-resume').addEventListener('click', () => { AudioSys.sfx.click(); resumeGame(); });
  $('btn-retry').addEventListener('click', () => { AudioSys.sfx.click(); restartRun(run, run.practice); resumeGame(); });
  $('btn-practice').addEventListener('click', () => {
    run.practice = !run.practice;
    if (!run.practice) run.checkpoints.length = 0;
    $('btn-practice').textContent = run.practice ? 'PRACTICE MODE: ON' : 'PRACTICE MODE: OFF';
    toast(run.practice ? 'Practice mode: checkpoints drop automatically (Z = manual, X = remove)' : 'Practice mode off', 2800);
  });
  $('btn-exit').addEventListener('click', () => { AudioSys.sfx.click(); toMenu(); });
  $('btn-next').addEventListener('click', () => { AudioSys.sfx.click(); startLevel(run.level.meta.id + 1); });
  $('btn-replay').addEventListener('click', () => { AudioSys.sfx.click(); startLevel(run.level.meta.id); });
  $('btn-menu').addEventListener('click', () => { AudioSys.sfx.click(); toMenu(); });
  $('btn-mute').addEventListener('click', () => {
    $('btn-mute').textContent = AudioSys.toggleMute() ? '🔇' : '🔊';
  });
  $('btn-full').addEventListener('click', () => {
    const el = document.getElementById('wrap');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
  });

  /* ========================= main loop ========================= */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (state === 'menu' || state === 'select') {
      ensureDemo();
      updateRun(demoRun, dt);
      render(demoRun, true);
    } else if (state === 'play') {
      updateRun(run, dt);
      render(run, false);
      refreshHud(run);
    } else if (state === 'pause' || state === 'win') {
      render(run, state === 'pause');
      if (state === 'win') { FX.update(dt); }
    }
    requestAnimationFrame(frame);
  }

  /* ==================== boot + test hooks ====================== */
  toMenu();
  requestAnimationFrame(frame);

  // Minimal hooks for automated testing / debugging.
  window.PulseDash = {
    getState: () => state,
    getRun: () => run,
    getPlayer: () => (run ? run.player : null),
    percent: () => (run ? percentOf(run) : 0),
    startLevel,
    press, release,
    setPractice: v => { if (run) run.practice = v; },
  };
})();
