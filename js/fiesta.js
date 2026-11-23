/* Benicàssim · fiesta de «Toute la semaine !»
   Cuando aparece la frase final de la diapositiva de la semana (paso 7) cae confeti por toda
   la diapositiva y entran gatitos bailando. Al retroceder o cambiar de diapositiva, todo se retira.
   No toca deck.js: observa la clase .is-shown de .week__end. Con «reducir movimiento» no hace nada. */
(() => {
  'use strict';

  const slide = document.getElementById('s-semaine');
  if (!slide) return;
  const end = slide.querySelector('.week__end');
  const canvas = slide.querySelector('.confetti');
  const cats = Array.from(slide.querySelectorAll('.cat'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ctx = canvas.getContext('2d');

  const W = 1920;   // coordenadas del lienzo de la diapositiva (la escala la pone el escenario)
  const H = 1080;
  canvas.width = W;
  canvas.height = H;

  const COLORS = ['#e8b931', '#e2574c', '#f08fb0', '#3f9c9a', '#f6f2e6', '#38450f', '#7aa63c'];
  const RAIN_MS = 9000;       // cuánto rato sigue naciendo confeti
  const PER_SECOND = 70;
  const GRAVITY = 520;        // px/s²
  const TERMINAL = 340;       // velocidad máxima de caída, px/s

  let pieces = [];
  let running = false;
  let raf = 0;
  let last = 0;
  let startedAt = 0;
  let spawnDebt = 0;
  let wasOn = false;

  const rand = (a, b) => a + Math.random() * (b - a);

  function spawn(burst) {
    pieces.push({
      x: rand(0, W),
      y: burst ? rand(-120, H * 0.35) : rand(-60, -10),
      vx: rand(-60, 60),
      vy: rand(60, 220),
      w: rand(14, 26),
      h: rand(8, 14),
      rot: rand(0, Math.PI * 2),
      spin: rand(-5, 5),
      flutter: rand(0, Math.PI * 2),
      flutterSpeed: rand(3, 7),
      color: COLORS[(Math.random() * COLORS.length) | 0],
    });
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const raining = running && now - startedAt < RAIN_MS;

    if (raining) {
      spawnDebt += PER_SECOND * dt;
      while (spawnDebt >= 1) { spawn(false); spawnDebt -= 1; }
    }

    ctx.clearRect(0, 0, W, H);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.vy = Math.min(TERMINAL, p.vy + GRAVITY * dt);
      p.vx *= 1 - 0.6 * dt;
      p.flutter += p.flutterSpeed * dt;
      p.x += (p.vx + Math.sin(p.flutter) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.y > H + 40) { pieces.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flutter));   // vuelta de la pieza al caer
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (running || pieces.length) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  function loadCats() {
    cats.forEach((img) => {
      if (img.getAttribute('src')) return;
      img.addEventListener('error', () => { img.hidden = true; }, { once: true });
      img.src = img.dataset.src;
    });
  }

  function start() {
    running = true;
    startedAt = performance.now();
    last = startedAt;
    spawnDebt = 0;
    for (let i = 0; i < 60; i++) spawn(true);   // salva inicial: la diapositiva ya está llena al llegar
    loadCats();
    cats.forEach((img, i) => { img.style.transitionDelay = `${140 + [0, 90, 210, 300, 420, 150, 360, 250][i % 8]}ms`; });
    slide.classList.add('is-party');
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    pieces = [];
    slide.classList.remove('is-party');
    cats.forEach((img) => { img.style.transitionDelay = ''; });
  }

  function sync() {
    const on = !reduceMotion.matches
      && !document.documentElement.classList.contains('is-list')
      && slide.classList.contains('is-active')
      && end.classList.contains('is-shown');
    if (on === wasOn) return;
    wasOn = on;
    if (on) start(); else stop();
  }

  const mo = new MutationObserver(sync);
  mo.observe(end, { attributes: true, attributeFilter: ['class'] });
  mo.observe(slide, { attributes: true, attributeFilter: ['class'] });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });
  sync();
})();
