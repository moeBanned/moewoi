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

  const CLAWS = 4;
  const CLAW_GAP = CURSOR * 0.28;
  const DRAG_LIFE = 2200;
  const DRAG_MIN_STEP = 3;
  const CLICK_MOVE = 5;

  const PAPER_TOP = '#9c6573';
  const PAPER_BOTTOM = '#8a5663';
  const PAPER_RULE = 'rgba(255, 232, 240, 0.32)';
  const PAPER_RADIUS = 7;
  const PAPER_PAD_X = 8;
  const PAPER_PAD_Y = 4;
  const PAPER_MARGIN = 8;
  const PAPER_MAX_PIXELS = 8000000;
  const PAPER_EXCLUDE = '.site-header, .site-footer, script, style, canvas, noscript';
  const CELL = 2;
  const SLIT_MIN = 3;
  const SLIT_MAX = 4.4;
  const GRAVITY = 70;
  const FALL_MAX = 170;
  const FADE_TIME = 0.8;
  const FINE_MAX = 650000;
  const TRAIL_BUCKETS = 28;

  const bgCanvas = document.getElementById('bg');
  const fxCanvas = document.getElementById('fx');
  if (!bgCanvas || !fxCanvas) {
    return;
  }
  const bg = bgCanvas.getContext('2d');
  const fxc = fxCanvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fx = [];
  const trails = [];
  const pieces = [];
  const curveBuf = new Float32Array((CURVE_STEPS + 1) * 4);
  const pawPath = new Path2D();

  let w = 0;
  let h = 0;
  let raf = 0;
  let lastFrame = 0;
  let dirty = false;
  let resizeQueued = false;
  let selectionQueued = false;
  let last = null;
  let stepDist = 0;
  let side = 1;
  let lastWheel = 0;
  let lastWheelDir = 0;
  let drag = null;
  let sheet = null;
  let sheetLock = false;
  let suppressClick = false;

  PAW_SHAPES.forEach(function (s) {
    const p = new Path2D();
    p.ellipse(s[0], s[1], s[2], s[3], s[4] * Math.PI / 180, 0, TAU);
    pawPath.addPath(p);
  });

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
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
    const bdpr = Math.min(dpr, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    fxCanvas.width = Math.round(w * dpr);
    fxCanvas.height = Math.round(h * dpr);
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCanvas.width = Math.round(w * bdpr);
    bgCanvas.height = Math.round(h * bdpr);
    bg.setTransform(bdpr, 0, 0, bdpr, 0, 0);
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
      if (sheet) {
        clearPaper();
      }
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

  function floorY() {
    const f = document.querySelector('.site-footer');
    return f ? f.getBoundingClientRect().top : h;
  }

  function drawPieces(dt) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const floor = floorY();
    let keep = 0;
    bg.imageSmoothingEnabled = true;
    bg.imageSmoothingQuality = 'high';
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      p.age += dt;
      if (p.landed) {
        p.vy = Math.max(0, p.vy - 260 * dt);
        p.vr *= Math.max(0, 1 - 3 * dt);
      } else {
        p.vy = Math.min(FALL_MAX, p.vy + GRAVITY * dt);
      }
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const px = p.x0 + p.vx * p.age + (Math.sin(p.age * p.sf + p.sp) - Math.sin(p.sp)) * p.sa;
      const cy = p.y - sy;
      const th = p.rot + (Math.sin(p.age * p.sf * 0.8 + p.sp) - Math.sin(p.sp)) * 0.12;
      const reach = Math.abs(Math.cos(th)) * p.h / 2 + Math.abs(Math.sin(th)) * p.w / 2;
      p.cx = px - sx;
      p.cy = cy;
      p.th = th;
      if (cy + reach >= floor) {
        p.landed = true;
        p.fade += dt / FADE_TIME;
      }
      const alpha = 1 - p.fade;
      if (alpha <= 0 || cy - reach > h) {
        continue;
      }
      pieces[keep++] = p;
      bg.save();
      bg.globalAlpha = alpha;
      bg.shadowColor = 'rgba(0, 0, 0, 0.55)';
      bg.shadowBlur = 5;
      bg.shadowOffsetY = 2;
      bg.translate(p.cx, cy);
      bg.rotate(th);
      bg.drawImage(p.canvas, -p.w / 2, -p.h / 2, p.w, p.h);
      bg.restore();
    }
    pieces.length = keep;
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
    const r = 3 + t * f.r;
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

  function createTrail() {
    const t = { pts: [], dx: 0, dy: 0, jit: [], gain: [], ended: false, n: 0 };
    for (let k = 0; k < CLAWS; k++) {
      t.jit.push(0);
      t.gain.push(rand(0.8, 1.15));
    }
    trails.push(t);
    return t;
  }

  function clawPoints(t, x, y, nx, ny) {
    const c = [];
    for (let k = 0; k < CLAWS; k++) {
      const off = (k - (CLAWS - 1) / 2) * CLAW_GAP + t.jit[k];
      c.push({ x: x + nx * off, y: y + ny * off });
    }
    return c;
  }

  function extendTrail(t, x, y, now) {
    const pts = t.pts;
    const prev = pts[pts.length - 1];
    if (!prev) {
      pts.push({ x: x, y: y, t: now, n: t.n++, c: null });
      return null;
    }
    const dx = x - prev.x;
    const dy = y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d < DRAG_MIN_STEP) {
      return null;
    }
    const ux = dx / d;
    const uy = dy / d;
    if (t.dx === 0 && t.dy === 0) {
      t.dx = ux;
      t.dy = uy;
    } else {
      const sx = t.dx * 0.82 + ux * 0.18;
      const sy = t.dy * 0.82 + uy * 0.18;
      const sl = Math.hypot(sx, sy) || 1;
      t.dx = sx / sl;
      t.dy = sy / sl;
    }
    for (let k = 0; k < CLAWS; k++) {
      t.jit[k] = clamp(t.jit[k] * 0.9 + rand(-0.12, 0.12), -0.7, 0.7);
    }
    const nx = -t.dy;
    const ny = t.dx;
    if (!prev.c) {
      prev.c = clawPoints(t, prev.x, prev.y, nx, ny);
    }
    const p = { x: x, y: y, t: now, n: t.n++, c: clawPoints(t, x, y, nx, ny) };
    pts.push(p);
    if (pts.length > 500) {
      pts.shift();
    }
    return { a: prev, b: p };
  }

  function strokeSmooth(list, k) {
    const n = list.length;
    if (n < 2) {
      return;
    }
    fxc.beginPath();
    fxc.moveTo(list[0].c[k].x, list[0].c[k].y);
    if (n === 2) {
      fxc.lineTo(list[1].c[k].x, list[1].c[k].y);
    } else {
      for (let i = 1; i < n - 1; i++) {
        const q = list[i].c[k];
        const r = list[i + 1].c[k];
        fxc.quadraticCurveTo(q.x, q.y, (q.x + r.x) / 2, (q.y + r.y) / 2);
      }
      fxc.lineTo(list[n - 1].c[k].x, list[n - 1].c[k].y);
    }
    fxc.stroke();
  }

  function drawTrails(now) {
    let keep = 0;
    fxc.lineCap = 'butt';
    fxc.lineJoin = 'round';
    for (let ti = 0; ti < trails.length; ti++) {
      const t = trails[ti];
      const pts = t.pts;
      let alive = !t.ended;
      const groups = [];
      let g = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const age = now - p.t;
        if (age >= DRAG_LIFE || !p.c) {
          g = null;
          continue;
        }
        alive = true;
        const b = Math.min(TRAIL_BUCKETS - 1, Math.floor(age / DRAG_LIFE * TRAIL_BUCKETS));
        if (!g || g.b !== b) {
          const prev = g ? g.pts[g.pts.length - 1] : null;
          g = { b: b, pts: prev ? [prev, p] : [p] };
          groups.push(g);
        } else {
          g.pts.push(p);
        }
      }
      for (let gi = 0; gi < groups.length; gi++) {
        const grp = groups[gi];
        if (grp.pts.length < 2) {
          continue;
        }
        const u = (grp.b + 0.5) / TRAIL_BUCKETS;
        const ramp = Math.min(1, grp.pts[0].n / 6);
        const a = 0.42 * Math.pow(1 - u, 1.3) * ramp;
        fxc.lineWidth = 0.9 + 0.9 * (1 - u);
        for (let k = 0; k < CLAWS; k++) {
          fxc.strokeStyle = rgba(SCRATCH_COLOR, a * t.gain[k]);
          strokeSmooth(grp.pts, k);
        }
      }
      if (alive) {
        trails[keep++] = t;
      }
    }
    trails.length = keep;
  }

  function drawFx(now) {
    if (!fx.length && !trails.length) {
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
    drawTrails(now);
  }

  function renderSheet(sh) {
    const c = sh.ctx;
    const W = sh.W;
    const H = sh.H;
    const S = sh.S;
    sh.dirty = false;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAPER_TOP);
    g.addColorStop(1, PAPER_BOTTOM);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = PAPER_RULE;
    c.lineWidth = Math.max(1, S * 0.9);
    c.beginPath();
    for (let i = 0; i < sh.lines.length; i++) {
      const y = Math.round((sh.lines[i].bottom + 1.5 - sh.y0) * S) + 0.5;
      c.moveTo(0, y);
      c.lineTo(W, y);
    }
    c.stroke();
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(sh.mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }

  function buildMask(sh) {
    const S = sh.S;
    const tmp = document.createElement('canvas');
    tmp.width = sh.W;
    tmp.height = sh.H;
    const t = tmp.getContext('2d');
    t.fillStyle = '#000';
    for (let i = 0; i < sh.lines.length; i++) {
      const l = sh.lines[i];
      t.fillRect((l.eL - sh.x0) * S, (l.eT - sh.y0) * S, (l.eR - l.eL) * S, (l.eB - l.eT) * S);
    }
    const m = sh.mctx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, sh.W, sh.H);
    if ('filter' in m) {
      m.filter = 'blur(' + PAPER_RADIUS * 0.55 * S + 'px)';
      m.drawImage(tmp, 0, 0);
      m.filter = 'none';
      const img = m.getImageData(0, 0, sh.W, sh.H);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) {
        const v = (d[i] - 128) * 6 + 128;
        d[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      m.putImageData(img, 0, 0);
    } else {
      m.drawImage(tmp, 0, 0);
    }
  }

  function labelAlpha(a, W, H, cd) {
    const cols = Math.ceil(W / cd);
    const rows = Math.ceil(H / cd);
    const n = cols * rows;
    const filled = new Uint8Array(n);
    if (cd === 1) {
      for (let i = 0; i < n; i++) {
        filled[i] = a[i * 4 + 3] > 127 ? 1 : 0;
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const y = Math.min(H - 1, Math.floor((r + 0.5) * cd));
        for (let c = 0; c < cols; c++) {
          const x = Math.min(W - 1, Math.floor((c + 0.5) * cd));
          if (a[(y * W + x) * 4 + 3] > 127) {
            filled[r * cols + c] = 1;
          }
        }
      }
    }
    const labels = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    const comps = [];
    for (let i = 0; i < n; i++) {
      if (!filled[i] || labels[i] !== -1) {
        continue;
      }
      const comp = { id: comps.length, size: 0, minc: cols, maxc: 0, minr: rows, maxr: 0, first: i };
      let sp = 0;
      stack[sp++] = i;
      labels[i] = comp.id;
      while (sp) {
        const j = stack[--sp];
        const r = (j / cols) | 0;
        const c = j - r * cols;
        comp.size++;
        if (c < comp.minc) { comp.minc = c; }
        if (c > comp.maxc) { comp.maxc = c; }
        if (r < comp.minr) { comp.minr = r; }
        if (r > comp.maxr) { comp.maxr = r; }
        if (c > 0 && filled[j - 1] && labels[j - 1] === -1) { labels[j - 1] = comp.id; stack[sp++] = j - 1; }
        if (c < cols - 1 && filled[j + 1] && labels[j + 1] === -1) { labels[j + 1] = comp.id; stack[sp++] = j + 1; }
        if (r > 0 && filled[j - cols] && labels[j - cols] === -1) { labels[j - cols] = comp.id; stack[sp++] = j - cols; }
        if (r < rows - 1 && filled[j + cols] && labels[j + cols] === -1) { labels[j + cols] = comp.id; stack[sp++] = j + cols; }
      }
      comps.push(comp);
    }
    return { labels: labels, comps: comps, cols: cols, rows: rows };
  }

  function analyze(sh) {
    const img = sh.mctx.getImageData(0, 0, sh.W, sh.H);
    const r = labelAlpha(img.data, sh.W, sh.H, sh.cd);
    return { img: img, labels: r.labels, comps: r.comps, cols: r.cols, rows: r.rows };
  }

  function neighborLabel(labels, cols, rows, x, y) {
    if (x > 0 && labels[y * cols + x - 1] !== -1) { return labels[y * cols + x - 1]; }
    if (x < cols - 1 && labels[y * cols + x + 1] !== -1) { return labels[y * cols + x + 1]; }
    if (y > 0 && labels[(y - 1) * cols + x] !== -1) { return labels[(y - 1) * cols + x]; }
    if (y < rows - 1 && labels[(y + 1) * cols + x] !== -1) { return labels[(y + 1) * cols + x]; }
    return -1;
  }

  function minCells(cd, sc) {
    const cell = (cd / sc) * (cd / sc);
    return Math.max(3, Math.ceil(2 / cell));
  }

  function extractComp(c, res, cd, W, H, src, zero) {
    const labels = res.labels;
    const cols = res.cols;
    const rows = res.rows;
    const px0 = Math.max(0, Math.floor((c.minc - 1) * cd));
    const py0 = Math.max(0, Math.floor((c.minr - 1) * cd));
    const px1 = Math.min(W, Math.ceil((c.maxc + 2) * cd));
    const py1 = Math.min(H, Math.ceil((c.maxr + 2) * cd));
    const pw = px1 - px0;
    const ph = py1 - py0;
    if (pw < 1 || ph < 1) {
      return null;
    }
    const out = c.keep ? new ImageData(pw, ph) : null;
    for (let y = py0; y < py1; y++) {
      const r = Math.min(rows - 1, Math.floor(y / cd));
      for (let x = px0; x < px1; x++) {
        const cc = Math.min(cols - 1, Math.floor(x / cd));
        let lab = labels[r * cols + cc];
        const i = (y * W + x) * 4;
        if (lab === -1 && cd === 1) {
          if (zero[i + 3] === 0) {
            continue;
          }
          lab = neighborLabel(labels, cols, rows, x, y);
          if (lab === -1) {
            continue;
          }
        }
        if (lab !== c.id && lab !== -1) {
          continue;
        }
        if (out && lab === c.id) {
          const o = ((y - py0) * pw + (x - px0)) * 4;
          out.data[o] = src[i];
          out.data[o + 1] = src[i + 1];
          out.data[o + 2] = src[i + 2];
          out.data[o + 3] = src[i + 3];
        }
        zero[i + 3] = 0;
      }
    }
    if (!out) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(out, 0, 0);
    return { canvas: canvas, px0: px0, py0: py0, pw: pw, ph: ph };
  }

  function spawnPiece(canvas, x, y, pw, ph, base) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const p = {
      canvas: canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      w: pw,
      h: ph,
      sc: canvas.width / pw,
      x0: x + pw / 2,
      y: y + ph / 2,
      vx: rand(-5, 5),
      vy: rand(6, 18),
      rot: 0,
      vr: rand(-0.45, 0.45),
      sa: rand(8, 20),
      sf: rand(0.9, 1.7),
      sp: rand(0, TAU),
      age: 0,
      fade: 0,
      landed: false,
      cut: false,
      lastCheck: 0
    };
    if (base) {
      Object.keys(base).forEach(function (k) {
        p[k] = base[k];
      });
    }
    p.cx = p.x0 - sx;
    p.cy = p.y - sy;
    p.th = p.rot;
    if (pieces.length > 80) {
      pieces.shift();
    }
    pieces.push(p);
    start();
    return p;
  }

  function cutPiece(p, a, b) {
    const cs = Math.cos(p.th);
    const sn = Math.sin(p.th);
    const hw = p.w / 2;
    const hh = p.h / 2;
    const ax = a.x - p.cx;
    const ay = a.y - p.cy;
    const bx = b.x - p.cx;
    const by = b.y - p.cy;
    const lax = ax * cs + ay * sn;
    const lay = -ax * sn + ay * cs;
    const lbx = bx * cs + by * sn;
    const lby = -bx * sn + by * cs;
    const pad = 4;
    if ((lax < -hw - pad && lbx < -hw - pad) || (lax > hw + pad && lbx > hw + pad) ||
        (lay < -hh - pad && lby < -hh - pad) || (lay > hh + pad && lby > hh + pad)) {
      return;
    }
    const c = p.ctx;
    const mx = (lax + lbx) / 2 + rand(-1.3, 1.3);
    const my = (lay + lby) / 2 + rand(-1.3, 1.3);
    c.setTransform(p.sc, 0, 0, p.sc, hw * p.sc, hh * p.sc);
    c.globalCompositeOperation = 'destination-out';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#000';
    c.lineWidth = rand(SLIT_MIN, SLIT_MAX);
    c.beginPath();
    c.moveTo(lax, lay);
    c.lineTo(mx, my);
    c.lineTo(lbx, lby);
    c.stroke();
    c.globalCompositeOperation = 'source-over';
    c.setTransform(1, 0, 0, 1, 0, 0);
    p.cut = true;
  }

  function tearPieces(seg) {
    for (let k = 0; k < CLAWS; k++) {
      const a = seg.a.c[k];
      const b = seg.b.c[k];
      for (let i = 0; i < pieces.length; i++) {
        cutPiece(pieces[i], a, b);
      }
    }
  }

  function splitPiece(p) {
    const W = p.canvas.width;
    const H = p.canvas.height;
    const img = p.ctx.getImageData(0, 0, W, H);
    const cd = W * H <= FINE_MAX ? 1 : Math.max(1, CELL * p.sc);
    const res = labelAlpha(img.data, W, H, cd);
    if (res.comps.length === 1) {
      return false;
    }
    const src = new Uint8ClampedArray(img.data);
    const zero = img.data;
    const min = minCells(cd, p.sc);
    const cs = Math.cos(p.th);
    const sn = Math.sin(p.th);
    const sx = window.scrollX;
    const sy = window.scrollY;
    res.comps.forEach(function (c) {
      c.keep = c.size >= min;
      const ex = extractComp(c, res, cd, W, H, src, zero);
      if (!ex) {
        return;
      }
      const lcx = (ex.px0 + ex.pw / 2) / p.sc - p.w / 2;
      const lcy = (ex.py0 + ex.ph / 2) / p.sc - p.h / 2;
      const wx = lcx * cs - lcy * sn;
      const wy = lcx * sn + lcy * cs;
      const cw = ex.pw / p.sc;
      const ch = ex.ph / p.sc;
      spawnPiece(ex.canvas, p.cx + wx + sx - cw / 2, p.cy + wy + sy - ch / 2, cw, ch, {
        rot: p.th,
        vx: p.vx + rand(-12, 12),
        vy: p.vy + rand(0, 10),
        vr: p.vr + rand(-0.4, 0.4),
        fade: p.fade,
        landed: p.landed
      });
    });
    return true;
  }

  function checkPieces(force) {
    const now = performance.now();
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (!p.cut || (!force && now - p.lastCheck < 90)) {
        continue;
      }
      p.cut = false;
      p.lastCheck = now;
      if (splitPiece(p)) {
        pieces.splice(i, 1);
      }
    }
  }

  function checkSheet() {
    const sh = sheet;
    if (!sh || !sh.cut || !sh.group) {
      return;
    }
    sh.cut = false;
    const res = analyze(sh);
    const comps = res.comps;
    const best = new Map();
    comps.forEach(function (c) {
      const g = sh.group[c.first];
      const b = best.get(g);
      if (!b || c.size > b.size) {
        best.set(g, c);
      }
    });
    const falling = comps.filter(function (c) {
      return best.get(sh.group[c.first]) !== c;
    });
    if (falling.length) {
      const disp = sh.ctx.getImageData(0, 0, sh.W, sh.H).data;
      const min = minCells(sh.cd, sh.S);
      falling.forEach(function (c) {
        c.keep = c.size >= min;
        const ex = extractComp(c, res, sh.cd, sh.W, sh.H, disp, res.img.data);
        if (ex) {
          spawnPiece(ex.canvas, sh.x0 + ex.px0 / sh.S, sh.y0 + ex.py0 / sh.S, ex.pw / sh.S, ex.ph / sh.S);
        }
      });
      sh.mctx.putImageData(res.img, 0, 0);
      sh.dirty = true;
      start();
    }
    if (!comps.length || (falling.length && comps.length === falling.length)) {
      removeSheet(true);
    }
  }

  function cutSegment(sh, a, b) {
    const m = sh.mctx;
    const mx = (a.x + b.x) / 2 + rand(-1.3, 1.3);
    const my = (a.y + b.y) / 2 + rand(-1.3, 1.3);
    m.setTransform(sh.S, 0, 0, sh.S, 0, 0);
    m.globalCompositeOperation = 'destination-out';
    m.lineCap = 'round';
    m.lineJoin = 'round';
    m.strokeStyle = '#000';
    m.lineWidth = rand(SLIT_MIN, SLIT_MAX);
    m.beginPath();
    m.moveTo(a.x - sh.x0, a.y - sh.y0);
    m.lineTo(mx - sh.x0, my - sh.y0);
    m.lineTo(b.x - sh.x0, b.y - sh.y0);
    m.stroke();
    m.globalCompositeOperation = 'source-over';
    sh.cut = true;
    sh.dirty = true;
  }

  function removeSheet(immediate) {
    if (!sheet) {
      return;
    }
    const el = sheet.canvas;
    sheet = null;
    if (immediate) {
      el.remove();
      return;
    }
    el.style.transition = 'opacity 0.25s';
    el.style.opacity = '0';
    setTimeout(function () {
      el.remove();
    }, 300);
  }

  function clearPaper() {
    sheetLock = false;
    removeSheet(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
    }
  }

  function selectionLines() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const root = common.nodeType === 3 ? common.parentNode : common;
    const sx = window.scrollX;
    const sy = window.scrollY;
    const rects = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) {
        continue;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest(PAPER_EXCLUDE)) {
        continue;
      }
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (to <= from || !/\S/.test(node.data.slice(from, to))) {
        continue;
      }
      const r = document.createRange();
      r.setStart(node, from);
      r.setEnd(node, to);
      const list = r.getClientRects();
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (q.width < 1 || q.height < 1) {
          continue;
        }
        rects.push({ left: q.left + sx, top: q.top + sy, right: q.right + sx, bottom: q.bottom + sy });
      }
    }
    rects.sort(function (a, b) {
      return a.top - b.top || a.left - b.left;
    });
    const lines = [];
    rects.forEach(function (r) {
      const rh = r.bottom - r.top;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
        if (overlap > 0.5 * Math.min(rh, l.bottom - l.top) && r.left - l.right < rh * 1.5 && l.left - r.right < rh * 1.5) {
          l.left = Math.min(l.left, r.left);
          l.right = Math.max(l.right, r.right);
          l.top = Math.min(l.top, r.top);
          l.bottom = Math.max(l.bottom, r.bottom);
          return;
        }
      }
      lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
    lines.sort(function (a, b) {
      return a.top - b.top;
    });
    return lines;
  }

  function buildSheet(lines) {
    removeSheet(true);
    lines.forEach(function (l) {
      l.eL = l.left - PAPER_PAD_X;
      l.eR = l.right + PAPER_PAD_X;
      l.eT = l.top - PAPER_PAD_Y;
      l.eB = l.bottom + PAPER_PAD_Y;
    });
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      const overlapX = Math.min(a.eR, b.eR) - Math.max(a.eL, b.eL);
      if (overlapX > 0 && b.top - a.bottom < 40) {
        const mid = (a.bottom + b.top) / 2;
        a.eB = Math.max(a.bottom, mid + 1);
        b.eT = Math.min(b.top, mid - 1);
      }
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    lines.forEach(function (l) {
      x0 = Math.min(x0, l.eL);
      y0 = Math.min(y0, l.eT);
      x1 = Math.max(x1, l.eR);
      y1 = Math.max(y1, l.eB);
    });
    x0 = Math.floor(x0 - PAPER_MARGIN);
    y0 = Math.floor(y0 - PAPER_MARGIN);
    x1 = Math.ceil(x1 + PAPER_MARGIN);
    y1 = Math.ceil(y1 + PAPER_MARGIN);
    const sw = x1 - x0;
    const sh = y1 - y0;
    let S = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));
    while (S > 1 && sw * sh * S * S > FINE_MAX) {
      S -= 0.5;
    }
    S = Math.max(1, S);
    if (sw < 4 || sh < 4 || sw * sh * S * S > PAPER_MAX_PIXELS) {
      return;
    }
    const W = Math.round(sw * S);
    const H = Math.round(sh * S);
    const cd = W * H <= FINE_MAX ? 1 : CELL * S;
    const canvas = document.createElement('canvas');
    canvas.className = 'paper-sheet';
    canvas.width = W;
    canvas.height = H;
    canvas.style.left = x0 + 'px';
    canvas.style.top = y0 + 'px';
    canvas.style.width = sw + 'px';
    canvas.style.height = sh + 'px';
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    sheet = {
      canvas: canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      mask: mask,
      mctx: mask.getContext('2d', { willReadFrequently: true }),
      lines: lines,
      x0: x0,
      y0: y0,
      W: W,
      H: H,
      S: S,
      cd: cd,
      cols: Math.ceil(W / cd),
      rows: Math.ceil(H / cd),
      group: null,
      cut: false,
      dirty: false,
      lastCheck: 0
    };
    buildMask(sheet);
    renderSheet(sheet);
    document.body.appendChild(canvas);
  }

  function syncSheet() {
    const sel = window.getSelection();
    const empty = !sel || sel.rangeCount === 0 || sel.isCollapsed;
    if (empty) {
      sheetLock = false;
      removeSheet(false);
      return;
    }
    if (sheetLock) {
      return;
    }
    const lines = selectionLines();
    if (!lines || !lines.length) {
      removeSheet(false);
      return;
    }
    buildSheet(lines);
  }

  function onSelectionChange() {
    if (selectionQueued) {
      return;
    }
    selectionQueued = true;
    requestAnimationFrame(function () {
      selectionQueued = false;
      syncSheet();
    });
  }

  let lastWave = 0;

  function frame(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    const still = reduceMotion.matches;
    if (pieces.length || (!still && now - lastWave >= 30)) {
      lastWave = now;
      drawWaves(still ? 0 : now);
    }
    if (pieces.length) {
      drawPieces(dt);
    }
    if (sheet && sheet.dirty) {
      renderSheet(sheet);
    }
    drawFx(now);
    if (!still || fx.length || trails.length || pieces.length) {
      raf = requestAnimationFrame(frame);
    } else {
      lastFrame = 0;
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

  function dragPoint(x, y, now) {
    const d = drag;
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > CLICK_MOVE) {
      d.moved = true;
    }
    if (d.fx === undefined) {
      d.fx = x;
      d.fy = y;
    } else {
      d.fx += (x - d.fx) * 0.6;
      d.fy += (y - d.fy) * 0.6;
    }
    const seg = extendTrail(d.trail, d.fx, d.fy, now);
    if (!seg) {
      return;
    }
    if (pieces.length) {
      tearPieces(seg);
      checkPieces(false);
    }
    if (d.mode !== 'tear' || !sheet) {
      return;
    }
    const sx = window.scrollX;
    const sy = window.scrollY;
    for (let k = 0; k < CLAWS; k++) {
      const a = seg.a.c[k];
      const b = seg.b.c[k];
      cutSegment(sheet, { x: a.x + sx, y: a.y + sy }, { x: b.x + sx, y: b.y + sy });
    }
    if (now - sheet.lastCheck > Math.max(90, sheet.W * sheet.H / FINE_MAX * 200)) {
      sheet.lastCheck = now;
      checkSheet();
    }
    start();
  }

  function onMove(e) {
    if (e.pointerType === 'touch') {
      return;
    }
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;
    if (drag) {
      if (e.buttons & 1) {
        const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        const evs = list && list.length ? list : [e];
        for (let i = 0; i < evs.length; i++) {
          dragPoint(evs[i].clientX, evs[i].clientY, now);
        }
        start();
      } else {
        endDrag();
      }
    }
    if (e.buttons & 1) {
      last = { x: x, y: y };
      stepDist = 0;
      return;
    }
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
        const px = x - Math.sin(ang) * off;
        const py = y + Math.cos(ang) * off;
        addPaw(px, py, CURSOR / 3, ang + Math.PI / 2, 0.55, 1400);
        addFx({ type: RIPPLE, x: px, y: py, r: CURSOR * 1.1, born: now, life: 1200 });
      }
    }
    last = { x: x, y: y };
  }

  function onDown(e) {
    last = { x: e.clientX, y: e.clientY };
    suppressClick = false;
    if (e.button !== 0 || e.pointerType === 'touch') {
      addPaw(e.clientX, e.clientY, CURSOR * 1.4, rand(-0.35, 0.35), 0.6, 1800);
      return;
    }
    const target = e.target;
    const interactive = target && target.closest && target.closest('a, button, input, textarea, select, summary, label');
    const mode = sheet && !interactive ? 'tear' : 'select';
    const trail = createTrail();
    extendTrail(trail, e.clientX, e.clientY, performance.now());
    drag = { mode: mode, trail: trail, sx: e.clientX, sy: e.clientY, moved: false };
    if (mode === 'tear') {
      sheetLock = true;
      if (!sheet.group) {
        sheet.group = analyze(sheet).labels;
      }
    }
    start();
  }

  function endDrag() {
    const d = drag;
    if (!d) {
      return;
    }
    drag = null;
    d.trail.ended = true;
    if (!d.moved) {
      addPaw(d.sx, d.sy, CURSOR * 1.4, rand(-0.35, 0.35), 0.6, 1800);
    }
    checkPieces(true);
    if (d.mode === 'tear') {
      suppressClick = true;
      setTimeout(function () {
        suppressClick = false;
      }, 120);
      if (d.moved) {
        checkSheet();
      } else {
        clearPaper();
      }
    } else if (!d.moved && Math.random() < CLICK_SCRATCH_CHANCE) {
      addScratch(d.sx, d.sy, rand(0, TAU), CURSOR * rand(1, 1.5), 0.15, 500, 2800);
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
  window.addEventListener('pointerup', endDrag, { passive: true });
  window.addEventListener('pointercancel', endDrag, { passive: true });
  window.addEventListener('mousedown', function (e) {
    if (drag && drag.mode === 'tear') {
      e.preventDefault();
    }
  });
  window.addEventListener('click', function (e) {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet) {
      clearPaper();
    }
  });
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('selectionchange', onSelectionChange);
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener('change', function () {
      resize();
      start();
    });
  }
  resize();
  start();
})();
