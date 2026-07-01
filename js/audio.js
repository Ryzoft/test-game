/* ============================================================
   PULSE DASH — audio.js
   Fully procedural WebAudio: a scheduled synthwave loop per
   level theme + all sound effects. No audio files needed.
   ============================================================ */
'use strict';

const AudioSys = (() => {
  let ctx = null;
  let master, musicBus, duck, sfxBus;
  let muted = false;

  /* ---- music scheduler state ---- */
  let track = null;        // current track definition
  let timer = null;        // setInterval handle
  let step = 0;            // 16th-note counter
  let nextTime = 0;        // ctx time of next step
  let lastKick = -10;      // ctx time of last kick (drives visual pulse)
  let intensity = 1;       // 0..1, fades lead/drums in menus

  const LOOKAHEAD = 0.12;  // s of audio scheduled ahead
  const TICK = 25;         // ms scheduler interval

  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  /* Track definitions per theme.
     prog: chord roots (midi). Each chord lasts one bar (16 steps).
     bassPat / leadPat: 16-step patterns; lead values are chord offsets. */
  const TRACKS = [
    { // Stereo Sunrise — warm, laid back
      bpm: 128, wave: 'sawtooth',
      prog: [57, 53, 48, 55],                    // Am F C G
      bassPat: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,1],
      leadPat: [0,-1,3,-1, 7,-1,3,-1, 12,-1,7,-1, 3,7,12,-1],
      hat: 2, snare: false,
    },
    { // Neon Overdrive — driving minor
      bpm: 140, wave: 'sawtooth',
      prog: [52, 48, 55, 50],                    // Em C G D
      bassPat: [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,1,0,1],
      leadPat: [0,3,7,3, 12,7,3,7, 0,3,7,10, 12,10,7,3],
      hat: 1, snare: true,
    },
    { // Hyper Voltage — aggressive
      bpm: 150, wave: 'square',
      prog: [50, 50, 53, 45],                    // Dm Dm Fm(ish) A
      bassPat: [1,1,0,1, 1,0,1,1, 1,1,0,1, 1,0,1,1],
      leadPat: [0,12,3,7, 0,12,7,3, 10,7,3,0, 12,7,15,12],
      hat: 1, snare: true,
    },
  ];

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);

      duck = ctx.createGain();          // sidechain duck for music
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.55;
      musicBus.connect(duck);
      duck.connect(master);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.8;
      sfxBus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* ---------------- music ---------------- */

  function playTrack(themeIndex, level = 1) {
    ensure();
    stopMusic();
    track = TRACKS[themeIndex % TRACKS.length];
    intensity = level;
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    timer = setInterval(schedule, TICK);
  }

  function stopMusic() {
    if (timer) { clearInterval(timer); timer = null; }
    track = null;
  }

  function schedule() {
    if (!track || !ctx) return;
    const spb = 60 / track.bpm / 4;             // seconds per 16th
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime, spb);
      nextTime += spb;
      step = (step + 1) % 64;                   // 4 bars loop
    }
  }

  function scheduleStep(s, t, spb) {
    const bar = (s >> 4) & 3;
    const i16 = s & 15;
    const root = track.prog[bar];

    // Kick: four on the floor + sidechain duck
    if (i16 % 4 === 0) {
      kick(t);
      lastKick = t;
      duck.gain.cancelScheduledValues(t);
      duck.gain.setValueAtTime(0.55, t);
      duck.gain.linearRampToValueAtTime(1.0, t + 0.22);
    }
    // Snare on 2 & 4
    if (track.snare && intensity > 0.5 && (i16 === 4 || i16 === 12)) snare(t);
    // Hats on offbeats
    if (i16 % track.hat === 0 && i16 % 4 === 2) hat(t, 0.5);
    else if (track.hat === 1 && i16 % 2 === 1) hat(t, 0.22);

    // Bass
    if (track.bassPat[i16]) bassNote(midi(root - 24), t, spb * 0.9);

    // Lead arp (fades with intensity)
    const off = track.leadPat[i16];
    if (off >= 0 && intensity > 0.25) leadNote(midi(root + off), t, spb * 1.8);

    // Pad at bar starts
    if (i16 === 0) pad(root, t, spb * 16);
  }

  function envGain(t, a, peak, d, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest);
    return g;
  }

  function kick(t) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = envGain(t, 0.002, 1.0, 0.16, master);
    o.connect(g); o.start(t); o.stop(t + 0.2);
  }

  function noiseBuf() {
    if (!noiseBuf.b) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf.b = b;
    }
    return noiseBuf.b;
  }

  function snare(t) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = envGain(t, 0.001, 0.5, 0.14, musicBus);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.16);
  }

  function hat(t, vol) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf();
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8200;
    const g = envGain(t, 0.001, 0.16 * vol * intensity, 0.045, musicBus);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.06);
  }

  function bassNote(freq, t, dur) {
    const o = ctx.createOscillator(); o.type = track.wave; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(950, t);
    f.frequency.exponentialRampToValueAtTime(320, t + dur);
    const g = envGain(t, 0.004, 0.42, dur, musicBus);
    o.connect(f); f.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }

  function leadNote(freq, t, dur) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq; o.detune.value = det;
      const g = envGain(t, 0.01, 0.075 * intensity, dur, musicBus);
      o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    }
  }

  function pad(root, t, dur) {
    for (const iv of [0, 3, 7]) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = midi(root + iv);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(musicBus);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  /* Visual pulse: 1.0 right on a kick, decaying to 0 */
  function beatPulse() {
    if (!ctx || !track) return 0;
    const dt = ctx.currentTime - lastKick;
    return dt < 0 ? 1 : Math.max(0, 1 - dt * 3.4);
  }

  /* ---------------- SFX ---------------- */

  function blip(freq0, freq1, dur, type, vol) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(freq1, 1), t + dur);
    const g = envGain(t, 0.004, vol, dur, sfxBus);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }

  const sfx = {
    jump()   { blip(560, 830, 0.09, 'square', 0.10); },
    orb()    { blip(700, 1400, 0.12, 'triangle', 0.28); },
    pad()    { blip(300, 1200, 0.18, 'sawtooth', 0.22); },
    portal() { blip(1500, 220, 0.30, 'sine', 0.30); },
    coin()   { blip(1180, 1770, 0.09, 'square', 0.22);
               setTimeout(() => blip(1570, 2350, 0.12, 'square', 0.2), 70); },
    click()  { blip(900, 600, 0.05, 'square', 0.15); },
    checkpoint() { blip(880, 1320, 0.1, 'sine', 0.2); },
    death()  {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf();
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(3000, t);
      f.frequency.exponentialRampToValueAtTime(160, t + 0.4);
      const g = envGain(t, 0.002, 0.55, 0.42, sfxBus);
      src.connect(f); f.connect(g); src.start(t); src.stop(t + 0.45);
      blip(240, 40, 0.45, 'sawtooth', 0.3);
    },
    win() {
      if (!ctx || muted) return;
      [0, 4, 7, 12, 16].forEach((iv, i) =>
        setTimeout(() => blip(midi(72 + iv), midi(72 + iv) * 1.01, 0.22, 'triangle', 0.3), i * 110));
    },
  };

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    return muted;
  }

  return { ensure, playTrack, stopMusic, beatPulse, sfx, toggleMute,
           setIntensity: v => { intensity = v; },
           isMuted: () => muted };
})();
