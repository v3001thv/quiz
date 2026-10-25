/* Визуальные эффекты: живой фон, фейерверки, конфетти, искры, дождь. Без внешних библиотек. */
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PALETTE = ["#FFD23F", "#FF9F68", "#FF5E8A", "#B9A5F0", "#5DD9C1", "#8FC1FF", "#FFFFFF"];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------- 1. Фон: созвездие, которое отталкивается от курсора ---------- */
  const bg = document.getElementById("bg");
  const bctx = bg.getContext("2d");
  let BW = 0, BH = 0, dpr = 1, nodes = [];
  const mouse = { x: -9999, y: -9999 };

  function resizeBg() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    BW = bg.width = Math.floor(innerWidth * dpr);
    BH = bg.height = Math.floor(innerHeight * dpr);
    const count = Math.round(Math.min(90, (innerWidth * innerHeight) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * BW, y: Math.random() * BH,
      vx: rand(-0.25, 0.25) * dpr, vy: rand(-0.25, 0.25) * dpr,
      r: rand(0.8, 2.2) * dpr, c: pick(PALETTE),
    }));
  }
  addEventListener("pointermove", (e) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; }, { passive: true });
  addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });

  function drawBg() {
    bctx.clearRect(0, 0, BW, BH);
    const link = 140 * dpr;
    for (const n of nodes) {
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
      if (d < 160 * dpr && d > 0) { n.vx += (dx / d) * 0.06 * dpr; n.vy += (dy / d) * 0.06 * dpr; }
      n.vx *= 0.985; n.vy *= 0.985;
      if (Math.abs(n.vx) < 0.05 * dpr) n.vx += rand(-0.03, 0.03) * dpr;
      if (Math.abs(n.vy) < 0.05 * dpr) n.vy += rand(-0.03, 0.03) * dpr;
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0) n.x += BW; if (n.x > BW) n.x -= BW;
      if (n.y < 0) n.y += BH; if (n.y > BH) n.y -= BH;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) {
          bctx.strokeStyle = `rgba(200,215,255,${(1 - d / link) * 0.18})`;
          bctx.lineWidth = dpr;
          bctx.beginPath(); bctx.moveTo(a.x, a.y); bctx.lineTo(b.x, b.y); bctx.stroke();
        }
      }
    }
    for (const n of nodes) {
      bctx.fillStyle = n.c; bctx.globalAlpha = 0.75;
      bctx.beginPath(); bctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); bctx.fill();
    }
    bctx.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(drawBg);
  }
  resizeBg();
  addEventListener("resize", () => { resizeBg(); resizeFx(); });
  drawBg();

  /* ---------- 2. Эффекты поверх всего ---------- */
  const fx = document.getElementById("fx");
  const ctx = fx.getContext("2d");
  let W = 0, H = 0, fdpr = 1;
  let parts = [];
  let running = false;
  let spawners = [];

  function resizeFx() {
    fdpr = Math.min(window.devicePixelRatio || 1, 2);
    W = fx.width = Math.floor(innerWidth * fdpr);
    H = fx.height = Math.floor(innerHeight * fdpr);
  }
  resizeFx();

  function start() {
    if (running) return;
    running = true;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(50, now - last) / 16.67; last = now;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      spawners = spawners.filter((s) => s(now));
      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) update(p, dt);
      parts = parts.filter((p) => p.life > 0 && p.y < H + 60 * fdpr);
      ctx.globalCompositeOperation = "source-over";
      for (const p of parts) if (p.kind === "confetti" || p.kind === "drop") draw(p);
      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) if (p.kind !== "confetti" && p.kind !== "drop") draw(p);
      if (parts.length || spawners.length) requestAnimationFrame(frame);
      else { running = false; ctx.clearRect(0, 0, W, H); }
    };
    requestAnimationFrame(frame);
  }

  function update(p, dt) {
    p.life -= dt;
    if (p.kind === "rocket") {
      p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 10) p.trail.shift();
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.06 * fdpr * dt;
      if (p.vy >= -1.2 * fdpr || p.life <= 0) { explode(p.x, p.y, p.power, p.colors); p.life = 0; }
      return;
    }
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === "confetti") { p.rot += p.vr * dt; p.wob += 0.12 * dt; p.x += Math.sin(p.wob) * 0.6 * fdpr; }
    if (p.kind === "star") p.tw += 0.2 * dt;
  }

  function draw(p) {
    const a = Math.max(0, Math.min(1, p.life / p.max));
    if (p.kind === "rocket") {
      ctx.strokeStyle = p.colors[0]; ctx.lineWidth = 2.5 * fdpr; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      p.trail.forEach((t, i) => (i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y)));
      ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * fdpr, 0, 6.3); ctx.fill();
    } else if (p.kind === "spark") {
      ctx.globalAlpha = a; ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, 6.3); ctx.fill();
      ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, 6.3); ctx.fill();
    } else if (p.kind === "confetti") {
      ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, Math.abs(Math.cos(p.wob)) * 0.8 + 0.2);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    } else if (p.kind === "star") {
      ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(p.tw)); ctx.fillStyle = p.c;
      star(p.x, p.y, p.r);
    } else if (p.kind === "drop") {
      ctx.globalAlpha = a * 0.6; ctx.strokeStyle = p.c; ctx.lineWidth = 2 * fdpr;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  function explode(x, y, power = 1, colors = PALETTE) {
    const n = Math.round(70 * power);
    const ring = Math.random() < 0.35;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      const sp = (ring ? 5.2 : rand(1.5, 6.5)) * fdpr * (0.7 + power * 0.3);
      const max = rand(45, 80);
      parts.push({ kind: "spark", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.05 * fdpr, drag: 0.965, r: rand(1.4, 2.8) * fdpr, c: pick(colors), life: max, max });
    }
    if (power > 1.1) {
      for (let i = 0; i < 26; i++) {
        const ang = rand(0, 6.3), sp = rand(0.5, 2.2) * fdpr, max = rand(60, 100);
        parts.push({ kind: "star", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.02 * fdpr, drag: 0.97, r: rand(3, 6) * fdpr, c: "#FFFFFF", tw: rand(0, 6), life: max, max });
      }
    }
  }

  function rocket(power = 1) {
    const colors = [pick(PALETTE), pick(PALETTE), pick(PALETTE)];
    parts.push({
      kind: "rocket", x: rand(W * 0.12, W * 0.88), y: H + 10, vx: rand(-1.2, 1.2) * fdpr,
      vy: -rand(11, 15) * fdpr * Math.sqrt(H / (900 * fdpr)), trail: [], life: 140, max: 140, power, colors,
    });
  }

  const FX = {
    /** Фейерверк: duration мс, rate — ракет в секунду, power — размер взрывов */
    fireworks(duration = 6000, rate = 2.5, power = 1.2) {
      if (reduce) { this.confetti(80); return; }
      const end = performance.now() + duration;
      let acc = 0, last = performance.now();
      for (let i = 0; i < 3; i++) setTimeout(() => rocket(power), i * 180);
      spawners.push((now) => {
        acc += ((now - last) / 1000) * rate; last = now;
        while (acc >= 1) { rocket(power); acc -= 1; }
        return now < end;
      });
      start();
    },
    /** Конфетти из двух «пушек» по краям экрана */
    confetti(count = 160) {
      for (let i = 0; i < count; i++) {
        const left = i % 2 === 0;
        const max = rand(160, 260);
        parts.push({
          kind: "confetti", x: left ? -10 : W + 10, y: H * rand(0.55, 0.85),
          vx: (left ? 1 : -1) * rand(5, 15) * fdpr, vy: -rand(9, 19) * fdpr, g: 0.28 * fdpr, drag: 0.975,
          w: rand(7, 13) * fdpr, h: rand(10, 18) * fdpr, rot: rand(0, 6.3), vr: rand(-0.25, 0.25), wob: rand(0, 6.3),
          c: pick(PALETTE.slice(0, 6)), life: max, max,
        });
      }
      start();
    },
    /** Тихие искорки-звёзды, поднимающиеся снизу */
    sparkles(duration = 5000, perSec = 14) {
      const end = performance.now() + duration;
      let acc = 0, last = performance.now();
      spawners.push((now) => {
        acc += ((now - last) / 1000) * perSec; last = now;
        while (acc >= 1) {
          acc -= 1;
          const max = rand(120, 200);
          parts.push({ kind: "star", x: rand(0, W), y: H + 10, vx: rand(-0.4, 0.4) * fdpr, vy: -rand(1.5, 3.2) * fdpr, g: 0, drag: 1, r: rand(3, 7) * fdpr, c: pick(["#FFD23F", "#8FC1FF", "#B9A5F0", "#FFFFFF"]), tw: rand(0, 6), life: max, max });
        }
        return now < end;
      });
      start();
    },
    /** Грустный дождик */
    rain(duration = 4000, perSec = 60) {
      if (reduce) return;
      const end = performance.now() + duration;
      let acc = 0, last = performance.now();
      spawners.push((now) => {
        acc += ((now - last) / 1000) * perSec; last = now;
        while (acc >= 1) {
          acc -= 1;
          const max = 160;
          parts.push({ kind: "drop", x: rand(-50, W), y: -20, vx: 1.2 * fdpr, vy: rand(9, 14) * fdpr, g: 0.1 * fdpr, drag: 1, c: "#8FC1FF", life: max, max });
        }
        return now < end;
      });
      start();
    },
    /** Одиночный взрыв в точке экрана (CSS-пиксели) */
    burst(x, y, power = 0.6) { explode(x * fdpr, y * fdpr, power); start(); },
    clear() { parts = []; spawners = []; },
  };
  window.FX = FX;
})();
