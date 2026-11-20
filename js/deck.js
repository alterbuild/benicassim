/* Benicàssim · motor de la presentación
   - Flechas, espacio, AvPág/RePág (mandos de presentación), Inicio/Fin, F = pantalla completa.
   - En una diapositiva de vuelo, "siguiente" mientras el vídeo corre salta al final (aterriza).
   - El altímetro lee la altitud real de la cámara de cada fotograma (js/altitudes.js). */
(() => {
  'use strict';

  const root = document.documentElement;
  const stage = document.getElementById('stage');
  const slides = Array.from(stage.querySelectorAll('.slide'));
  const rail = document.getElementById('rail');
  const track = rail.querySelector('.rail__track');
  const marker = document.getElementById('rail-marker');
  const readout = document.getElementById('rail-value');
  const stops = Array.from(rail.querySelectorAll('.rail__stop'));
  const controls = document.getElementById('controls');
  const count = document.getElementById('count');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnFull = document.getElementById('btn-full');

  const DATA = window.FLIGHT_DATA || { fps: 30, flights: {} };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

  let index = 0;
  let listMode = false;

  const isFlight = (s) => s.classList.contains('slide--flight');
  const videoOf = (s) => s.querySelector('video');
  const altsOf = (s) => DATA.flights[s.dataset.flight] || [];

  /* ---------------------------------------------------------------- altímetro */

  const LOG_TOP = Math.log10(60e6);
  const LOG_BOTTOM = Math.log10(400);

  function railY(alt) {
    const t = (LOG_TOP - Math.log10(Math.max(alt, 1))) / (LOG_TOP - LOG_BOTTOM);
    return Math.min(1, Math.max(0, t)) * track.offsetHeight;
  }

  function formatAlt(m) {
    // Separador de miles francés, con un espacio normal no separable (se lee mejor proyectado)
    const fr = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, ' ');
    if (m >= 100000) return `${fr(Math.round(m / 10000) * 10)} km`;
    if (m >= 10000) return `${fr(Math.round(m / 1000))} km`;
    if (m >= 1000) return `${fr(m / 1000, 1)} km`;
    return `${fr(Math.round(m / 10) * 10)} m`;
  }

  // Las paradas del altímetro salen de los propios vuelos: inicio del 1 y final de cada uno
  const flightAlts = (name) => DATA.flights[name] || [];
  const STOP_ALTS = (() => {
    const names = slides.filter(isFlight).map((s) => s.dataset.flight);
    const first = flightAlts(names[0]);
    const ends = names.map((n) => flightAlts(n)).map((a) => a[a.length - 1]);
    return first.length ? [first[0], ...ends] : null;
  })();
  if (STOP_ALTS) stops.forEach((stop, i) => { if (STOP_ALTS[i]) stop.dataset.alt = String(STOP_ALTS[i]); });

  // Portada y plan: en el espacio. Diapositivas de contenido: a la altura de la ciudad.
  function altFor(slide) {
    if (slide.dataset.alt === 'ville') return Number(stops[stops.length - 1].dataset.alt);
    return Number(stops[0].dataset.alt);
  }

  function layoutRail() {
    stops.forEach((stop) => { stop.style.top = `${railY(Number(stop.dataset.alt))}px`; });
  }

  let lastText = '';
  function setAltitude(alt) {
    marker.style.transform = `translateY(${railY(alt).toFixed(1)}px)`;
    const text = formatAlt(alt);
    if (text !== lastText) { readout.textContent = text; lastText = text; }
    let best = null;
    let bestD = Infinity;
    stops.forEach((stop) => {
      const d = Math.abs(Math.log10(alt) - Math.log10(Number(stop.dataset.alt)));
      if (d < bestD) { bestD = d; best = stop; }
    });
    stops.forEach((stop) => stop.classList.toggle('is-current', stop === best));
  }

  /* ---------------------------------------------------------------- límites al aterrizar
     Trazados ya proyectados sobre el último fotograma (js/borders.js, 1920 × 1080). */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BORDERS = window.FLIGHT_BORDERS || {};

  function buildBorders() {
    slides.filter(isFlight).forEach((slide) => {
      const paths = BORDERS[slide.dataset.flight];
      if (!paths || !paths.length) return;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'borders');
      svg.setAttribute('viewBox', '0 0 1920 1080');
      svg.setAttribute('aria-hidden', 'true');
      ['casing', 'line'].forEach((cls) => {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', cls);
        paths.forEach((d) => {
          const p = document.createElementNS(SVG_NS, 'path');
          p.setAttribute('d', d);
          g.appendChild(p);
        });
        svg.appendChild(g);
      });
      slide.querySelector('.canvas').insertBefore(svg, slide.querySelector('.cartouche'));
      svg.querySelectorAll('path').forEach((p) => {
        const len = Math.ceil(p.getTotalLength()) + 2;
        p.style.strokeDasharray = `${len}`;
        p.style.setProperty('--len', `${len}`);
      });
    });
  }

  /* ---------------------------------------------------------------- vuelos */

  function follow(slide) {
    const v = videoOf(slide);
    const alts = altsOf(slide);
    const fps = DATA.fps || 30;
    const tick = () => {
      if (slide.dataset.state !== 'playing') return;
      if (alts.length) setAltitude(alts[Math.min(alts.length - 1, Math.round(v.currentTime * fps))]);
      requestAnimationFrame(tick);
    };
    tick();
  }

  function seekToEnd(v) {
    const go = () => { v.currentTime = Math.max(0, v.duration - 0.04); };
    if (v.readyState >= 1 && Number.isFinite(v.duration)) go();
    else {
      v.poster = v.dataset.endPoster || v.poster;
      v.addEventListener('loadedmetadata', go, { once: true });
    }
  }

  function play(slide) {
    const v = videoOf(slide);
    slide.classList.remove('is-landed');
    slide.dataset.state = 'playing';
    v.onended = () => land(slide, false);
    try { v.currentTime = 0; } catch (e) { /* aún sin metadatos */ }
    const p = v.play();
    if (p && p.catch) {
      p.catch(() => {
        // Si el navegador no deja reproducir, espera a poder hacerlo
        v.addEventListener('canplay', () => { if (slide.dataset.state === 'playing') v.play().catch(() => land(slide, true)); }, { once: true });
      });
    }
    follow(slide);
  }

  function land(slide, jump, instant = false) {
    const v = videoOf(slide);
    v.onended = null;
    if (jump) { v.pause(); seekToEnd(v); }
    slide.dataset.state = 'landed';
    // Al volver atrás el límite ya está dibujado; al aterrizar se dibuja
    slide.classList.toggle('is-drawn', instant);
    slide.classList.add('is-landed');
    const alts = altsOf(slide);
    if (alts.length && slide.classList.contains('is-active')) setAltitude(alts[alts.length - 1]);
  }

  /* ---------------------------------------------------------------- órbita y paso del vuelo 3 al panel */

  function startOrbit(slide, flip) {
    const panel = slide.querySelector('.panel');
    const v = panel.querySelector('video');
    try { v.currentTime = 0; } catch (e) { /* sin metadatos */ }
    if (!reduceMotion.matches) v.play().catch(() => {});

    if (!flip) return;

    // FLIP: el panel empieza ocupando todo el lienzo (mismo fotograma que el final del vuelo 3)
    const L = panel.offsetLeft;
    const T = panel.offsetTop;
    const sx = 1920 / panel.offsetWidth;
    const sy = 1080 / panel.offsetHeight;
    stage.dataset.tone = 'dark';
    slide.classList.add('is-entering');
    const anim = panel.animate(
      [
        { transform: `translate(${-L}px, ${-T}px) scale(${sx}, ${sy})`, borderRadius: '0px' },
        { transform: 'none', borderRadius: '4px' }
      ],
      { duration: 760, easing: EASE_IN_OUT }
    );
    setTimeout(() => { if (slides[index] === slide) stage.dataset.tone = 'light'; }, 260);
    setTimeout(() => { slide.classList.add('is-risen'); }, 420);
    anim.onfinish = () => {
      setTimeout(() => slide.classList.remove('is-entering', 'is-risen'), 700);
    };
  }

  function stopOrbit(slide) {
    const panel = slide.querySelector('.panel');
    if (!panel) return;
    if (panel.getAnimations) panel.getAnimations().forEach((a) => a.finish());
    panel.querySelector('video').pause();
    slide.classList.remove('is-entering', 'is-risen');
  }

  /* ---------------------------------------------------------------- navegación */

  function leave(slide) {
    slide.classList.remove('is-active');
    if (isFlight(slide)) {
      const v = videoOf(slide);
      v.pause();
      v.onended = null;
      if (slide.dataset.state === 'playing') slide.dataset.state = 'ready';
    }
    stopOrbit(slide);
  }

  function activate(slide, dir, flip) {
    slide.classList.add('is-active');
    stage.dataset.slide = slide.id;
    stage.dataset.tone = slide.dataset.tone || (isFlight(slide) ? 'dark' : 'light');
    stage.dataset.rail = slide.dataset.rail || 'on';
    count.textContent = `${index + 1} / ${slides.length}`;
    if (history.replaceState) history.replaceState(null, '', `#${slide.id}`);

    if (isFlight(slide)) {
      if (dir > 0) play(slide);
      else { land(slide, true, true); }
    } else {
      setAltitude(altFor(slide));
    }
    if (slide.classList.contains('slide--situation')) startOrbit(slide, flip);
  }

  function go(i, dir) {
    if (i < 0 || i >= slides.length || i === index) return;
    const from = slides[index];
    const to = slides[i];
    const flip = dir > 0 && from.id === 's-vol-3' && to.id === 's-situation' && !reduceMotion.matches;
    const seamless = dir > 0 && isFlight(from) && isFlight(to);
    const instant = seamless || flip;
    from.classList.toggle('is-instant', instant);
    to.classList.toggle('is-instant', instant);
    leave(from);
    index = i;
    activate(to, dir, flip);
  }

  function next() {
    if (listMode) return;
    const s = slides[index];
    if (isFlight(s)) {
      if (s.dataset.state === 'playing') { land(s, true); return; }
      if (s.dataset.state !== 'landed') { play(s); return; }
    }
    go(index + 1, 1);
  }

  function prev() {
    if (listMode) return;
    go(index - 1, -1);
  }

  /* ---------------------------------------------------------------- escala y modos */

  function fit() {
    const wantList = window.innerWidth < 640 || window.innerHeight > window.innerWidth * 1.05;
    if (wantList !== listMode) setMode(wantList);
    if (listMode) {
      const w = document.getElementById('viewport').clientWidth - 32;
      root.style.setProperty('--s', (w / 1920).toFixed(5));
    } else {
      root.style.setProperty('--s', Math.min(window.innerWidth / 1920, window.innerHeight / 1080).toFixed(5));
    }
  }

  function setMode(list) {
    listMode = list;
    root.classList.toggle('is-list', list);
    slides.forEach((s) => {
      if (isFlight(s)) {
        const v = videoOf(s);
        v.pause();
        if (list) {
          v.preload = 'metadata';
          v.poster = v.dataset.endPoster || v.poster;
          s.dataset.state = 'landed';
          s.classList.add('is-landed');
        }
      }
    });
    if (!list) {
      slides.forEach((s) => s.classList.remove('is-active', 'is-instant', 'is-playing'));
      layoutRail();
      activate(slides[index], -1, false);
    }
  }

  // En modo lectura, tocar un vuelo lo reproduce desde el principio
  slides.forEach((s) => {
    if (!isFlight(s)) return;
    s.addEventListener('click', () => {
      if (!listMode) return;
      const v = videoOf(s);
      if (!v.paused) { v.pause(); s.classList.remove('is-playing'); return; }
      s.classList.add('is-playing');
      v.currentTime = 0;
      v.onended = () => s.classList.remove('is-playing');
      v.play().catch(() => s.classList.remove('is-playing'));
    });
  });

  /* ---------------------------------------------------------------- entrada */

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown':
        e.preventDefault(); next(); break;
      case ' ': case 'Enter':
        if (onButton) return;
        e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
        e.preventDefault(); prev(); break;
      case 'Home':
        e.preventDefault(); go(0, -1); break;
      case 'End':
        e.preventDefault(); go(slides.length - 1, -1); break;
      case 'f': case 'F':
        e.preventDefault(); toggleFullscreen(); break;
      default:
    }
  });

  stage.addEventListener('click', () => { if (!listMode) next(); });

  let touchX = null;
  stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') touchX = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (touchX === null) return;
    const dx = e.clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50 && !listMode) { e.preventDefault(); if (dx < 0) next(); else prev(); }
  });

  btnPrev.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  btnNext.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  btnFull.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });

  // Pantalla completa con y sin prefijo (Safari antiguo devuelve undefined en vez de una promesa)
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };
  function toggleFullscreen() {
    if (!fsElement()) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) quiet(req.call(root));
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) quiet(exit.call(document));
    }
  }
  const onFs = () => btnFull.setAttribute('aria-pressed', String(Boolean(fsElement())));
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  // Los mandos aparecen al mover el ratón y se esconden solos
  let hideTimer = 0;
  function showControls() {
    controls.classList.add('is-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => controls.classList.remove('is-visible'), 2400);
  }
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showControls(); });

  // Escalonado del texto que entra tras el aterrizaje
  slides.forEach((s) => s.querySelectorAll('[data-rise]').forEach((el, i) => el.style.setProperty('--i', i)));

  window.addEventListener('resize', fit);

  /* ---------------------------------------------------------------- precarga completa de los vídeos
     En clase la wifi puede ser lenta: al abrir la página se descargan los vuelos enteros a memoria
     y los mandos muestran el progreso ("Vidéos 3/4"). Si algo falla, el vídeo sigue con su URL normal. */

  const status = document.getElementById('preload');
  function playableSource(v) {
    const sources = Array.from(v.querySelectorAll('source'));
    for (const s of sources) {
      const type = s.getAttribute('type');
      if (!type || v.canPlayType(type)) return s.getAttribute('src');
    }
    return null;
  }
  async function preloadAll() {
    if (!window.fetch || location.protocol === 'file:') return;
    const videos = Array.from(stage.querySelectorAll('video'));
    let done = 0;
    const show = () => { status.textContent = done < videos.length ? `Vidéos ${done}/${videos.length}` : 'Vidéos prêtes'; };
    show();
    for (const v of videos) {
      const src = playableSource(v);
      if (!src) { done += 1; show(); continue; }
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(String(res.status));
        const url = URL.createObjectURL(await res.blob());
        const swap = () => {
          const t = v.currentTime;
          v.src = url;
          try { v.currentTime = t; } catch (e) { /* sin metadatos todavía */ }
        };
        if (v.paused) swap(); else v.addEventListener('pause', swap, { once: true });
      } catch (e) {
        /* se queda con la URL normal */
      }
      done += 1;
      show();
    }
    status.classList.add('is-done');
  }

  /* ---------------------------------------------------------------- arranque */

  buildBorders();
  const fromHash = slides.findIndex((s) => `#${s.id}` === location.hash);
  index = fromHash > 0 ? fromHash : 0;
  fit();
  if (!listMode) {
    layoutRail();
    activate(slides[index], fromHash > 0 ? -1 : 1, false);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutRail);
  if (!listMode) { showControls(); preloadAll(); }
})();
