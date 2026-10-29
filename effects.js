(function () {
  'use strict';

  const CURSOR = 24;
  const MAX_FX = 160;
  const CLICK_SCRATCH_CHANCE = 0.4;
  const WHEEL_GAP = 350;
  const TRAIL_STEP = CURSOR * 1.6;
  const TAU = Math.PI * 2;
  const PAW_COLOR = [255, 209, 227];
  const SCRATCH_COLOR = [255, 228, 238];
  const WHITE = [255, 255, 255];
  const PINK = [255, 150, 190];
  const PAW_SHAPES = [
    [12, 16, 6, 5, 0],
    [4.5, 11, 2.2, 2.8, -20],
    [9, 6, 2.3, 3, 0],
    [15, 6, 2.3, 3, 0],
    [19.5, 11, 2.2, 2.8, 20]
  ];
  const PAW = 0;
  const RIPPLE = 1;
  const SCRATCH = 2;
  const LAYER_COUNT = 6;
  const CURVE_STEPS = 12;

  const bgCanvas = document.getElementById('bg');
  const fxCanvas = document.getElementById('fx');
  if (!bgCanvas || !fxCanvas) {
    return;
  }
  const bg = bgCanvas.getContext('2d');
  const fxc = fxCanvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fx = [];
  const curveBuf = new Float32Array((CURVE_STEPS + 1) * 4);
  const pawPath = new Path2D();

  let w = 0;
  let h = 0;
  let raf = 0;
  let dirty = false;
  let resizeQueued = false;
  let last = null;
  let stepDist = 0;
  let side = 1;
  let lastRipple = 0;
  let lastWheel = 0;
  let lastWheelDir = 0;

  PAW_SHAPES.forEach(function (s) {
    const p = new Path2D();
    p.ellipse(s[0], s[1], s[2], s[3], s[4] * Math.PI / 180, 0, TAU);
    pawPath.addPath(p);
  });

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function waveColor(now) {
    const k = 0.5 - 0.5 * Math.cos(now * 0.00035);
    return [
      Math.round(WHITE[0] + (PINK[0] - WHITE[0]) * k),
      Math.round(WHITE[1] + (PINK[1] - WHITE[1]) * k),
      Math.round(WHITE[2] + (PINK[2] - WHITE[2]) * k)
    ];
  }

  function installCursor() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }
    const shapes = PAW_SHAPES.map(function (s) {
      return "<ellipse cx='" + s[0] + "' cy='" + s[1] + "' rx='" + s[2] + "' ry='" + s[3] + "' transform='rotate(" + s[4] + " " + s[0] + " " + s[1] + ")'/>";
    }).join('');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + CURSOR + "' height='" + CURSOR + "' viewBox='0 0 24 24'><g fill='rgb(" + PAW_COLOR.join(',') + ")'>" + shapes + '</g></svg>';
    const url = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + CURSOR / 2 + ' ' + CURSOR / 2 + ', auto';
    const style = document.createElement('style');
    style.textContent = 'html,html *{cursor:' + url + ' !important}';
    document.head.appendChild(style);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    fxCanvas.width = Math.round(w * dpr);
    fxCanvas.height = Math.round(h * dpr);
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCanvas.width = Math.round(w * dpr);
    bgCanvas.height = Math.round(h * dpr);
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirty = false;
    if (reduceMotion.matches) {
      drawWaves(0);
    }
  }

  function onResize() {
    if (resizeQueued) {
      return;
    }
    resizeQueued = true;
    requestAnimationFrame(function () {
      resizeQueued = false;
      resize();
    });
  }

  function drawWaves(now) {
    const c = waveColor(now);
    const step = Math.max(8, w / 140);
    const crest = rgba(c, 0.34);
    const body = rgba(c, 0.035);

    bg.clearRect(0, 0, w, h);
    bg.lineWidth = 2;
    bg.lineJoin = 'round';

    for (let i = 0; i < LAYER_COUNT; i++) {
      const base = h * (0.3 + 0.12 * i);
      const amp = h * (0.04 + 0.012 * (i % 3));
      const k = TAU / Math.max(420, w * (0.55 + 0.1 * (i % 4)));
      const phase = now * 0.0005 * (0.8 + 0.12 * i) + i * 1.7;
      const swellK = k * 0.37;
      const swellPhase = phase * 0.45 + i * 2;

      bg.beginPath();
      for (let x = -step; x <= w + step; x += step) {
        const th = k * x - phase;
        const y = base
          + amp * (Math.sin(th) + 0.3 * Math.sin(2 * th - 0.8))
          + amp * 0.6 * Math.sin(swellK * x - swellPhase);
        if (x === -step) {
          bg.moveTo(x, y);
        } else {
          bg.lineTo(x, y);
        }
      }
      bg.strokeStyle = crest;
      bg.stroke();
      bg.lineTo(w + step, h);
      bg.lineTo(-step, h);
      bg.closePath();
      bg.fillStyle = body;
      bg.fill();
    }

    const fade = bg.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.28, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    bg.globalCompositeOperation = 'destination-in';
    bg.fillStyle = fade;
    bg.fillRect(0, 0, w, h);
    bg.globalCompositeOperation = 'source-over';
  }

  function drawPaw(x, y, size, rot, alpha) {
    const s = size / 24;
    fxc.save();
    fxc.translate(x, y);
    fxc.rotate(rot);
    fxc.scale(s, s);
    fxc.translate(-12, -12);
    fxc.fillStyle = rgba(PAW_COLOR, alpha);
    fxc.fill(pawPath);
    fxc.restore();
  }

  function drawRipple(f, t, color) {
    const r = 4 + t * 40;
    const a = 0.32 * Math.pow(1 - t, 1.6);
    fxc.lineWidth = 1.2;
    fxc.strokeStyle = rgba(color, a);
    fxc.beginPath();
    fxc.arc(f.x, f.y, r, 0, TAU);
    fxc.stroke();
    fxc.strokeStyle = rgba(color, a * 0.6);
    fxc.beginPath();
    fxc.arc(f.x, f.y, r * 0.6, 0, TAU);
    fxc.stroke();
  }

  function drawScratch(f, age, t) {
    const a = f.alpha * Math.sin(Math.PI * t);
    const grow = Math.min(1, age / (f.life * 0.22));
    const prog = 1 - Math.pow(1 - grow, 3);
    const ca = f.ca;
    const sa = f.sa;

    fxc.fillStyle = rgba(SCRATCH_COLOR, a);

    for (let li = 0; li < f.lines.length; li++) {
      const l = f.lines[li];
      const x0 = f.x - sa * l.off;
      const y0 = f.y + ca * l.off;
      const x2 = x0 + ca * l.len;
      const y2 = y0 + sa * l.len;
      const qx = x0 + ca * l.len * 0.5 - sa * l.curve;
      const qy = y0 + sa * l.len * 0.5 + ca * l.curve;

      for (let i = 0; i <= CURVE_STEPS; i++) {
        const s = prog * i / CURVE_STEPS;
        const u = 1 - s;
        const px = u * u * x0 + 2 * u * s * qx + s * s * x2;
        const py = u * u * y0 + 2 * u * s * qy + s * s * y2;
        let tx = 2 * u * (qx - x0) + 2 * s * (x2 - qx);
        let ty = 2 * u * (qy - y0) + 2 * s * (y2 - qy);
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const profile = Math.pow(Math.sin(Math.PI * Math.min(1, s)), 0.7);
        const tip = Math.min(1, (prog - s) * 6 + 0.15);
        const half = f.width * 0.5 * profile * tip;
        const o = i * 4;
        curveBuf[o] = px;
        curveBuf[o + 1] = py;
        curveBuf[o + 2] = -ty * half;
        curveBuf[o + 3] = tx * half;
      }

      fxc.beginPath();
      for (let i = 0; i <= CURVE_STEPS; i++) {
        const o = i * 4;
        if (i === 0) {
          fxc.moveTo(curveBuf[o] + curveBuf[o + 2], curveBuf[o + 1] + curveBuf[o + 3]);
        } else {
          fxc.lineTo(curveBuf[o] + curveBuf[o + 2], curveBuf[o + 1] + curveBuf[o + 3]);
        }
      }
      for (let i = CURVE_STEPS; i >= 0; i--) {
        const o = i * 4;
        fxc.lineTo(curveBuf[o] - curveBuf[o + 2], curveBuf[o + 1] - curveBuf[o + 3]);
      }
      fxc.closePath();
      fxc.fill();
    }
  }

  function drawFx(now) {
    if (!fx.length) {
      if (dirty) {
        fxc.clearRect(0, 0, w, h);
        dirty = false;
      }
      return;
    }
    fxc.clearRect(0, 0, w, h);
    dirty = true;
    const color = waveColor(now);
    let keep = 0;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      const age = now - f.born;
      if (age >= f.life) {
        continue;
      }
      fx[keep++] = f;
      if (age < 0) {
        continue;
      }
      const t = age / f.life;
      if (f.type === PAW) {
        drawPaw(f.x, f.y, f.size, f.rot, f.alpha * Math.pow(1 - t, 1.4));
      } else if (f.type === RIPPLE) {
        drawRipple(f, t, color);
      } else {
        drawScratch(f, age, t);
      }
    }
    fx.length = keep;
  }

  function frame(now) {
    raf = 0;
    const still = reduceMotion.matches;
    if (!still) {
      drawWaves(now);
    }
    drawFx(now);
    if (!still || fx.length) {
      raf = requestAnimationFrame(frame);
    }
  }

  function start() {
    if (!raf) {
      raf = requestAnimationFrame(frame);
    }
  }

  function addFx(f) {
    if (fx.length >= MAX_FX) {
      fx.shift();
    }
    fx.push(f);
    start();
  }

  function addPaw(x, y, size, rot, alpha, life) {
    addFx({ type: PAW, x: x, y: y, size: size, rot: rot, alpha: alpha, born: performance.now(), life: life });
  }

  function addScratch(x, y, angle, size, alpha, delay, life) {
    const n = 2 + Math.floor(Math.random() * 3);
    const spacing = size * rand(0.14, 0.22);
    const bend = size * rand(-0.22, 0.22);
    const lines = [];
    for (let i = 0; i < n; i++) {
      lines.push({
        off: (i - (n - 1) / 2) * spacing,
        len: size * rand(0.75, 1.25),
        curve: bend * rand(0.7, 1.3)
      });
    }
    addFx({
      type: SCRATCH,
      x: x,
      y: y,
      ca: Math.cos(angle),
      sa: Math.sin(angle),
      lines: lines,
      width: Math.max(1.4, size * 0.045),
      alpha: alpha,
      born: performance.now() + delay,
      life: life
    });
  }

  function onMove(e) {
    if (e.pointerType === 'touch') {
      return;
    }
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const d = Math.hypot(dx, dy);
      stepDist += d;
      if (stepDist >= TRAIL_STEP) {
        stepDist = 0;
        const ang = Math.atan2(dy, dx);
        side = -side;
        const off = CURSOR * 0.18 * side;
        addPaw(x - Math.sin(ang) * off, y + Math.cos(ang) * off, CURSOR / 3, ang + Math.PI / 2, 0.55, 1400);
      }
      if (d > 0 && now - lastRipple > 70) {
        lastRipple = now;
        addFx({ type: RIPPLE, x: x, y: y, born: now, life: 1200 });
      }
    }
    last = { x: x, y: y };
  }

  function onDown(e) {
    last = { x: e.clientX, y: e.clientY };
    addPaw(e.clientX, e.clientY, CURSOR * 1.4, rand(-0.35, 0.35), 0.6, 1800);
    if (Math.random() < CLICK_SCRATCH_CHANCE) {
      addScratch(e.clientX, e.clientY, rand(0, TAU), CURSOR * rand(1, 1.5), 0.15, 700, 2800);
    }
  }

  function onWheel(e) {
    if (e.ctrlKey || e.deltaY === 0) {
      return;
    }
    const now = performance.now();
    const dir = e.deltaY < 0 ? -1 : 1;
    const fresh = now - lastWheel > WHEEL_GAP || dir !== lastWheelDir;
    lastWheel = now;
    lastWheelDir = dir;
    if (!fresh) {
      return;
    }
    const px = last ? last.x : w / 2;
    const py = last ? last.y : h / 2;
    const angle = (dir < 0 ? Math.PI / 2 : -Math.PI / 2) + rand(-0.25, 0.25);
    addScratch(px, py, angle, CURSOR * rand(4, 7), 0.22, 0, 2200);
  }

  installCursor();
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('resize', onResize);
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', function () {
      resize();
      start();
    });
  }
  resize();
  start();
})();
