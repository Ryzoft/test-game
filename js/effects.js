/* ============================================================
   PULSE DASH — effects.js
   Particles, expanding rings, screen shake and floating text.
   Everything draws in world space (caller translates camera).
   ============================================================ */
'use strict';

const FX = (() => {
  const parts = [];   // {x,y,vx,vy,life,maxLife,size,color,grav,spin,rot,shape}
  const rings = [];   // {x,y,r,vr,life,maxLife,color,width}
  const texts = [];   // {x,y,str,life,maxLife,color,size}
  const MAX_PARTS = 700;

  let shakeAmp = 0, shakeT = 0;

  function spawn(p) {
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push(p);
  }

  /* ---- emitters ---- */

  function trail(x, y, color) {
    spawn({ x, y, vx: -60 - Math.random() * 40, vy: (Math.random() - 0.5) * 50,
      life: 0.35, maxLife: 0.35, size: 9 + Math.random() * 6,
      color, grav: 0, spin: 0, rot: 0, shape: 'square' });
  }

  function dust(x, y, dir) {
    for (let i = 0; i < 6; i++) {
      spawn({ x: x + (Math.random() - 0.5) * 30, y,
        vx: (Math.random() - 0.2) * -160, vy: -Math.random() * 90 * dir,
        life: 0.4, maxLife: 0.4, size: 4 + Math.random() * 4,
        color: 'rgba(255,255,255,0.8)', grav: 0, spin: 0, rot: 0, shape: 'circle' });
    }
  }

  function explode(x, y, color, color2) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 180 + Math.random() * 480;
      spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.9, maxLife: 0.9, size: 5 + Math.random() * 10,
        color: Math.random() < 0.5 ? color : color2,
        grav: 900, spin: (Math.random() - 0.5) * 14, rot: Math.random() * 6,
        shape: 'square' });
    }
    ring(x, y, 10, 900, 0.45, color, 6);
    ring(x, y, 4, 520, 0.6, '#ffffff', 3);
    shake(14);
  }

  function confettiBurst(x, y) {
    const colors = ['#ff4dd8', '#31e8ff', '#ffe14d', '#5dff7f', '#ff9d3f'];
    for (let i = 0; i < 40; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 300 + Math.random() * 500;
      spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1.6, maxLife: 1.6, size: 5 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0],
        grav: 700, spin: (Math.random() - 0.5) * 18, rot: Math.random() * 6,
        shape: 'square' });
    }
  }

  function sparkle(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 200;
      spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5, maxLife: 0.5, size: 3 + Math.random() * 4,
        color, grav: 0, spin: 0, rot: 0, shape: 'circle' });
    }
  }

  function ring(x, y, r, vr, life, color, width) {
    rings.push({ x, y, r, vr, life, maxLife: life, color, width });
  }

  function text(x, y, str, color, size = 30) {
    texts.push({ x, y, str, life: 1.4, maxLife: 1.4, color, size });
  }

  function shake(amp) { shakeAmp = Math.max(shakeAmp, amp); shakeT = 0.35; }

  /* ---- sim ---- */

  function update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      r.r += r.vr * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
    if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shakeAmp = 0; }
  }

  function shakeOffset() {
    if (shakeT <= 0) return [0, 0];
    const a = shakeAmp * (shakeT / 0.35);
    return [(Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a];
  }

  /* ---- draw (in world space) ---- */

  function draw(g) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const a = p.life / p.maxLife;
      g.globalAlpha = a;
      g.fillStyle = p.color;
      if (p.shape === 'circle') {
        g.beginPath();
        g.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
        g.fill();
      } else {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        const s = p.size * a;
        g.fillRect(-s / 2, -s / 2, s, s);
        g.restore();
      }
    }
    for (const r of rings) {
      const a = r.life / r.maxLife;
      g.globalAlpha = a;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * a + 1;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    g.save();
    g.textAlign = 'center';
    for (const t of texts) {
      const a = Math.min(1, t.life / (t.maxLife * 0.5));
      g.globalAlpha = a;
      g.font = `700 ${t.size}px 'Orbitron', sans-serif`;
      g.fillStyle = t.color;
      g.fillText(t.str, t.x, t.y - (t.maxLife - t.life) * 26);
    }
    g.restore();
  }

  function clear() { parts.length = 0; rings.length = 0; texts.length = 0; shakeAmp = 0; shakeT = 0; }

  return { trail, dust, explode, confettiBurst, sparkle, ring, text,
           shake, shakeOffset, update, draw, clear };
})();
