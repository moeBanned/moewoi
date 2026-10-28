(function () {
  const CURSOR = 24;
  const CLICK_SCRATCH_CHANCE = 0.4;
  const MAX_FX = 220;
  const STEP = CURSOR * 1.6;
  const PAW_COLOR = [255, 209, 227];
  const SCRATCH_COLOR = [255, 225, 235];
  const WHITE = [255, 255, 255];
  const PINK = [255, 150, 190];
  const PAW_SHAPES = [
    [12, 16, 6, 5, 0],
    [4.5, 11, 2.2, 2.8, -20],
    [9, 6, 2.3, 3, 0],
    [15, 6, 2.3, 3, 0],
    [19.5, 11, 2.2, 2.8, 20]
  ];

  const canvas = document.getElementById('fx');
  const ctx = canvas.getContext('2d');
  const fx = [];
  let w = 0;
  let h = 0;
  let last = null;
  let stepDist = 0;
  let side = 1;
  let lastRipple = 0;
  let lastWheel = 0;

  const rand = function (a, b) {
    return a + Math.random() * (b - a);
  };

  const rgba = function (c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };

  function pawSvg() {
    const shapes = PAW_SHAPES.map(function (s) {
      return "<ellipse cx='" + s[0] + "' cy='" + s[1] + "' rx='" + s[2] + "' ry='" + s[3] + "' transform='rotate(" + s[4] + " " + s[0] + " " + s[1] + ")'/>";
    }).join('');
    return "<svg xmlns='http://www.w3.org/2000/svg' width='" + CURSOR + "' height='" + CURSOR + "' viewBox='0 0 24 24'><g fill='rgb(" + PAW_COLOR.join(',') + ")'>" + shapes + "</g></svg>";
  }

  const cursorUrl = 'url("data:image/svg+xml,' + encodeURIComponent(pawSvg()) + '") ' + CURSOR / 2 + ' ' + CURSOR / 2 + ', auto';
  const style = document.createElement('style');
  style.textContent = '*{cursor:' + cursorUrl + ' !important}';
  document.head.appendChild(style);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function waveColor(now) {
    const k = 0.5 - 0.5 * Math.cos(now * 0.00035);
    return [0, 1, 2].map(function (i) {
      return Math.round(WHITE[i] + (PINK[i] - WHITE[i]) * k);
    });
  }

  function addFx(obj) {
    fx.push(obj);
    if (fx.length > MAX_FX) {
      fx.shift();
    }
  }

  function addScratch(x, y, angle, size, alpha, delay, life) {
    const n = 2 + Math.floor(Math.random() * 3);
    const spacing = size * rand(0.14, 0.24);
    const curve = size * rand(-0.25, 0.25);
    const lines = [];
    for (let i = 0; i < n; i++) {
      lines.push({
        off: (i - (n - 1) / 2) * spacing,
        len: size * rand(0.75, 1.3),
        curve: curve * rand(0.7, 1.3)
      });
    }
    addFx({
      type: 'scratch',
      x: x,
      y: y,
      angle: angle,
      lines: lines,
      width: Math.max(1, size * 0.035),
      alpha: alpha,
      born: performance.now() + delay,
      life: life
    });
  }

  function drawPaw(x, y, size, rot, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const s = size / 24;
    ctx.scale(s, s);
    ctx.translate(-12, -12);
    ctx.fillStyle = rgba(PAW_COLOR, alpha);
    PAW_SHAPES.forEach(function (sh) {
      ctx.beginPath();
      ctx.ellipse(sh[0], sh[1], sh[2], sh[3], sh[4] * Math.PI / 180, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawWaves(now) {
    const c = waveColor(now);
    const lines = 6;
    for (let i = 0; i < lines; i++) {
      const baseY = h * (i + 1.2) / (lines + 1.4);
      const amp = 28 + i * 6 + 10 * Math.sin(now * 0.0002 + i);
      const freq = 0.01 - i * 0.0006;
      const phase = now * (0.0006 + i * 0.00008) + i * 1.7;
      ctx.beginPath();
      for (let x = -10; x <= w + 10; x += 10) {
        const y = baseY + amp * Math.sin(x * freq - phase) + amp * 0.35 * Math.sin(x * freq * 2.1 - phase * 1.3 + i);
        if (x === -10) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = rgba(c, 0.16);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.lineTo(w + 10, h + 10);
      ctx.lineTo(-10, h + 10);
      ctx.closePath();
      ctx.fillStyle = rgba(c, 0.014);
      ctx.fill();
    }
  }

  function drawScratch(f, age, t) {
    const a = f.alpha * Math.sin(Math.PI * t);
    const prog = Math.min(1, age / (f.life * 0.25));
    const ca = Math.cos(f.angle);
    const sa = Math.sin(f.angle);
    ctx.strokeStyle = rgba(SCRATCH_COLOR, a);
    ctx.lineWidth = f.width;
    ctx.lineCap = 'round';
    f.lines.forEach(function (l) {
      const sx = f.x - sa * l.off;
      const sy = f.y + ca * l.off;
      const len = l.len * prog;
      const ex = sx + ca * len;
      const ey = sy + sa * len;
      const qx = sx + ca * len * 0.5 - sa * l.curve * prog;
      const qy = sy + sa * len * 0.5 + ca * l.curve * prog;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(qx, qy, ex, ey);
      ctx.stroke();
    });
  }

  function drawFx(now) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      const age = now - f.born;
      if (age < 0) {
        continue;
      }
      const t = age / f.life;
      if (t >= 1) {
        fx.splice(i, 1);
        continue;
      }
      if (f.type === 'ripple') {
        const r = 4 + t * 40;
        const a = 0.3 * Math.pow(1 - t, 1.6);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(f.color, a);
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = rgba(f.color, a * 0.6);
        ctx.beginPath();
        ctx.arc(f.x, f.y, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.type === 'paw') {
        drawPaw(f.x, f.y, f.size, f.rot, f.alpha * Math.pow(1 - t, 1.4));
      } else {
        drawScratch(f, age, t);
      }
    }
  }

  function frame(now) {
    ctx.clearRect(0, 0, w, h);
    drawWaves(now);
    drawFx(now);
    requestAnimationFrame(frame);
  }

  window.addEventListener('pointermove', function (e) {
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const d = Math.hypot(dx, dy);
      stepDist += d;
      if (stepDist >= STEP) {
        stepDist = 0;
        const ang = Math.atan2(dy, dx);
        side = -side;
        const off = CURSOR * 0.18 * side;
        addFx({
          type: 'paw',
          x: x - Math.sin(ang) * off,
          y: y + Math.cos(ang) * off,
          size: CURSOR / 3,
          rot: ang + Math.PI / 2,
          alpha: 0.5,
          born: now,
          life: 1400
        });
      }
      if (d > 0 && now - lastRipple > 80) {
        lastRipple = now;
        addFx({ type: 'ripple', x: x, y: y, born: now, life: 1200, color: waveColor(now) });
      }
    }
    last = { x: x, y: y };
  });

  window.addEventListener('pointerdown', function (e) {
    const now = performance.now();
    addFx({
      type: 'paw',
      x: e.clientX,
      y: e.clientY,
      size: CURSOR * 1.4,
      rot: rand(-0.35, 0.35),
      alpha: 0.6,
      born: now,
      life: 1800
    });
    if (Math.random() < CLICK_SCRATCH_CHANCE) {
      addScratch(e.clientX, e.clientY, rand(0, Math.PI * 2), CURSOR * rand(1, 1.5), 0.13, 700, 2800);
    }
  });

  window.addEventListener('wheel', function (e) {
    const now = performance.now();
    if (now - lastWheel < 110) {
      return;
    }
    lastWheel = now;
    const toDown = e.deltaY < 0;
    const count = Math.abs(e.deltaY) > 100 ? 2 : 1;
    const origin = last || { x: w / 2, y: h / 2 };
    for (let k = 0; k < count; k++) {
      const angle = (toDown ? Math.PI / 2 : -Math.PI / 2) + rand(-0.3, 0.3);
      addScratch(origin.x + rand(-18, 18), origin.y + rand(-10, 10), angle, rand(90, 180), 0.2, 0, 2000);
    }
  }, { passive: true });

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
