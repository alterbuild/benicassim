/* Benicàssim · motor de la presentación
   - Flechas, espacio, AvPág/RePág (mandos de presentación), Inicio/Fin.
   - En una diapositiva de vuelo, "siguiente" mientras el vídeo corre salta al final (aterriza).
   - El altímetro lee la altitud real de la cámara de cada fotograma (js/altitudes.js).
   - Expone window.DECK (diapositiva, paso, fase del vuelo, ir a, siguiente, anterior y un aviso de cambios)
     para la barra (js/chrome.js) y para el modo presentador (js/presenter.js).
   - Con ?presenter no presenta nada: deja las diapositivas ya aterrizadas y completas, sin vídeos,
     para que la vista del orador las clone como miniaturas. */
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

  const DATA = window.FLIGHT_DATA || { fps: 30, flights: {} };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const PRESENTER = new URLSearchParams(location.search).has('presenter');

  let index = 0;
  let listMode = false;

  /* ---------------------------------------------------------------- API pública
     La barra y el presentador no tocan el motor: le preguntan por aquí y se enteran de los cambios. */
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* un oyente roto no para la presentación */ } });
  const titleOf = (s) => { const t = s.getAttribute('aria-label') || ''; return t.charAt(0).toUpperCase() + t.slice(1); };
  const RAW_NOTES = window.DECK_NOTES || {};
  const WPM = 120;   // ritmo de «hablando con calma», para repartir el tiempo entre diapositivas
  const notes = slides.map((s) => {
    const paras = RAW_NOTES[s.id] || [];
    const words = paras.join(' ').replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
    return { title: titleOf(s), text: paras.join('\n'), words, sec: words ? Math.max(8, Math.round((words / WPM) * 60)) : 0 };
  });
  const hooks = { nav: null };
  let held = false;   // un vuelo en pausa porque la pantalla está en negro

  /* Mientras los vídeos se descargan (precarga, más abajo) no se puede avanzar: ni teclas, ni clics, ni puntos,
     ni el presentador. `active` frena la navegación; `running` dura mientras haya descarga en marcha
     (si se pulsa «Commencer quand même» tras un fallo, se libera la navegación y la descarga sigue). */
  const gate = { running: false, active: false, total: 0, done: 0, frac: 0, failed: false };
  const unswapped = new Set();   // vídeos que aún no han cambiado a su copia en memoria
  function blocked() {
    const c = document.getElementById('ctrl');
    if (!c) return;
    c.classList.remove('is-nudged');
    void c.offsetWidth;
    c.classList.add('is-nudged');
  }

  const isFlight = (s) => s.classList.contains('slide--flight');
  const videoOf = (s) => s.querySelector('video');
  const altsOf = (s) => DATA.flights[s.dataset.flight] || [];

  /* Velocidad por vídeo: data-rate="1.5" en el <video>. defaultPlaybackRate sobrevive al cambio
     de src de la precarga (el navegador reinicia playbackRate a ese valor). El altímetro y las
     chinchetas leen currentTime, así que siguen sincronizados a cualquier velocidad. */
  const rateOf = (v) => Number(v.dataset.rate) || 1;
  function applyRate(v) {
    const r = rateOf(v);
    if (v.defaultPlaybackRate !== r) v.defaultPlaybackRate = r;
    if (v.playbackRate !== r) v.playbackRate = r;
  }
  stage.querySelectorAll('video[data-rate]').forEach(applyRate);

  /* ---------------------------------------------------------------- altímetro */

  const LOG_TOP = Math.log10(60e6);
  const LOG_BOTTOM = Math.log10(60);

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

  /* ---------------------------------------------------------------- progreso por partes
     Mismo hueco y aspecto que el altímetro. Cada parte ocupa 1/N de la pista y empieza en su parada;
     dentro de una parte el marcador avanza un poco en cada diapositiva. Créditos (data-section="fin"):
     la línea llena. */

  const prog = document.getElementById('sections');
  const progTrack = prog.querySelector('.rail__track');
  const progFill = prog.querySelector('.rail__fill');
  const progMarker = prog.querySelector('.rail__marker');
  const progValue = prog.querySelector('.rail__value');
  const progStops = Array.from(prog.querySelectorAll('.rail__stop'));
  const PARTS = progStops.length;
  progStops.forEach((stop, i) => { stop.style.top = `${(i / PARTS) * 100}%`; });
  let progShown = false;

  function setProgress(slide) {
    const key = slide.dataset.section;
    if (!key) return;
    const part = key === 'fin' ? PARTS + 1 : Number(key);
    const inPart = slides.filter((s) => s.dataset.section === key);
    // Dentro de la parte avanza como mucho media parte: el punto nunca parece estar ya en la siguiente
    const p = part > PARTS ? 1 : (part - 1 + 0.5 * (inPart.indexOf(slide) / inPart.length)) / PARTS;
    // La primera vez se coloca sin recorrer la pista desde arriba
    if (!progShown) prog.classList.add('is-still');
    progFill.style.transform = `scaleY(${p.toFixed(4)})`;
    progMarker.style.transform = `translateY(${(p * progTrack.offsetHeight).toFixed(1)}px)`;
    progValue.textContent = part > PARTS ? 'Fin' : `${part} sur ${PARTS}`;
    progStops.forEach((stop, i) => {
      stop.classList.toggle('is-current', i === part - 1);
      stop.classList.toggle('is-done', i < part - 1);
    });
    if (!progShown) {
      progShown = true;
      void prog.offsetWidth;
      prog.classList.remove('is-still');
    }
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

  /* ---------------------------------------------------------------- rótulos de países
     Nombres sobre el mapa del último fotograma (js/borders.js, FLIGHT_LABELS, generado por make_borders.py).
     Salen al aterrizar, cuando el límite ya está casi dibujado, y se van con él antes del siguiente vuelo. */

  const LABELS = window.FLIGHT_LABELS || {};

  function buildLabels() {
    slides.filter(isFlight).forEach((slide) => {
      const items = LABELS[slide.dataset.flight];
      if (!items || !items.length) return;
      const layer = document.createElement('ul');
      layer.className = 'countries';
      layer.setAttribute('aria-label', 'Pays sur la carte');
      items.forEach((c, i) => {
        const li = document.createElement('li');
        li.className = 'country' + (c.size ? ` country--${c.size}` : '');
        li.textContent = c.name;
        li.style.left = `${c.x}px`;
        li.style.top = `${c.y}px`;
        li.style.setProperty('--i', i);
        if (c.rot) li.style.setProperty('--rot', `${c.rot}deg`);
        layer.appendChild(li);
      });
      slide.querySelector('.canvas').insertBefore(layer, slide.querySelector('.cartouche'));
    });
  }

  /* ---------------------------------------------------------------- chinchetas
     Cabeza redonda en el punto exacto, línea fina hasta la etiqueta (en el mar).
     En el vuelo 2 aparecen al aterrizar; en el vuelo 3 siguen a su ciudad fotograma a fotograma. */

  const PINS = window.FLIGHT_PINS || {};
  const TRACKS = window.FLIGHT_PIN_TRACKS || {};

  // Crea la capa de chinchetas. Cada chincheta se mueve entera con un solo transform.
  function makePinLayer(slide, pins, tracked) {
    const layer = document.createElement('div');
    layer.className = 'pins' + (tracked ? ' pins--track' : '');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'pins__lines');
    svg.setAttribute('viewBox', '0 0 1920 1080');
    svg.setAttribute('aria-hidden', 'true');
    layer.appendChild(svg);
    const list = document.createElement('ul');
    list.className = 'pins__list';
    list.setAttribute('aria-label', 'Villes sur la carte');
    const handles = pins.map((p, i) => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.style.setProperty('--i', i);
      svg.appendChild(line);
      const item = document.createElement('li');
      item.className = 'pin' + (p.main ? ' pin--main' : '');
      item.style.setProperty('--i', i);
      const head = document.createElement('span');
      head.className = 'pin__head';
      const label = document.createElement('span');
      label.className = 'pin__label';
      label.style.left = `${p.dx}px`;
      label.style.top = `${p.dy}px`;
      const name = document.createElement('span');
      name.className = 'pin__name';
      name.textContent = p.name;
      label.appendChild(name);
      if (p.sub) {
        const sub = document.createElement('span');
        sub.className = 'pin__sub';
        sub.textContent = p.sub;
        label.appendChild(sub);
      }
      item.append(head, label);
      list.appendChild(item);
      return { item, line, dx: p.dx, dy: p.dy };
    });
    layer.appendChild(list);
    slide.querySelector('.canvas').insertBefore(layer, slide.querySelector('.cartouche'));
    return handles;
  }

  function placePin(h, xy) {
    if (!xy) {
      h.item.style.visibility = 'hidden';
      h.line.style.visibility = 'hidden';
      return;
    }
    const [x, y] = xy;
    h.item.style.visibility = '';
    h.line.style.visibility = '';
    h.item.style.transform = `translate(${x}px, ${y}px)`;
    h.line.setAttribute('x1', x);
    h.line.setAttribute('y1', y);
    h.line.setAttribute('x2', x + h.dx);
    h.line.setAttribute('y2', y + h.dy);
  }

  const pinTracks = new Map();   // diapositiva → { handles, frames }

  function buildPins() {
    slides.filter(isFlight).forEach((slide) => {
      const still = PINS[slide.dataset.flight];
      if (still && still.length) {
        const meta = still.map((p) => ({ ...p, dx: p.lx - p.x, dy: p.ly - p.y }));
        const handles = makePinLayer(slide, meta, false);
        handles.forEach((h, i) => placePin(h, [still[i].x, still[i].y]));
      }
      const track = TRACKS[slide.dataset.flight];
      if (track && track.frames.length) {
        const handles = makePinLayer(slide, track.pins, true);
        pinTracks.set(slide, { handles, frames: track.frames });
        trackPins(slide, 0);
      }
    });
  }

  function trackPins(slide, frame) {
    const t = pinTracks.get(slide);
    if (!t) return;
    const row = t.frames[Math.max(0, Math.min(t.frames.length - 1, frame))];
    t.handles.forEach((h, i) => placePin(h, row[i]));
  }

  /* ---------------------------------------------------------------- vuelos */

  /* Fundido final del vuelo 4: la foto que viene después (.flight-still) empieza a aparecer FADE_S segundos antes
     de que acabe el vídeo y llega a opacidad 1 justo al terminar. La opacidad se calcula en cada fotograma a partir
     del tiempo que le queda al vídeo (y de su velocidad), así el fundido y el vuelo van siempre a la par. */
  const FADE_S = 2;
  const smooth = (t) => t * t * (3 - 2 * t);

  function crossfade(slide, v) {
    const still = slide.querySelector('.flight-still');
    if (!still || !Number.isFinite(v.duration)) return;
    const left = (v.duration - v.currentTime) / (v.playbackRate || 1);
    const t = Math.min(1, Math.max(0, 1 - left / FADE_S));
    slide.classList.toggle('is-fading', t > 0);
    still.style.opacity = t > 0 ? smooth(t).toFixed(3) : '';
  }
  function clearCrossfade(slide) {
    const still = slide.querySelector('.flight-still');
    if (still) still.style.opacity = '';
    slide.classList.remove('is-fading');
  }

  function follow(slide) {
    const v = videoOf(slide);
    const alts = altsOf(slide);
    const fps = DATA.fps || 30;
    const tick = () => {
      if (slide.dataset.state !== 'playing') return;
      const frame = Math.round(v.currentTime * fps);
      if (alts.length) setAltitude(alts[Math.min(alts.length - 1, frame)]);
      trackPins(slide, frame);
      crossfade(slide, v);
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
    clearCrossfade(slide);
    slide.dataset.state = 'playing';
    v.onended = () => land(slide, false);
    try { v.currentTime = 0; } catch (e) { /* aún sin metadatos */ }
    trackPins(slide, 0);
    applyRate(v);
    const p = v.play();
    if (p && p.catch) {
      p.catch(() => {
        // Si el navegador no deja reproducir, espera a poder hacerlo
        v.addEventListener('canplay', () => { if (slide.dataset.state === 'playing') v.play().catch(() => land(slide, true)); }, { once: true });
      });
    }
    follow(slide);
    emit();
  }

  function land(slide, jump, instant = false) {
    const v = videoOf(slide);
    v.onended = null;
    if (jump) { v.pause(); seekToEnd(v); }
    slide.dataset.state = 'landed';
    clearCrossfade(slide);
    // Al volver atrás el límite ya está dibujado; al aterrizar se dibuja
    slide.classList.toggle('is-drawn', instant);
    slide.classList.add('is-landed');
    trackPins(slide, Infinity);
    const alts = altsOf(slide);
    if (alts.length && slide.classList.contains('is-active')) setAltitude(alts[alts.length - 1]);
    emit();
  }

  /* ---------------------------------------------------------------- órbita y paso del vuelo 3 al panel */

  function startOrbit(slide, flip) {
    const panel = slide.querySelector('.panel');
    const v = panel.querySelector('video');
    if (v) {
      try { v.currentTime = 0; } catch (e) { /* sin metadatos */ }
      if (!reduceMotion.matches) v.play().catch(() => {});
    }

    if (!flip) return;

    // FLIP: el panel empieza ocupando todo el lienzo (la misma foto con la que acaba el vuelo 4)
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
    const v = panel.querySelector('video');
    if (v) v.pause();
    slide.classList.remove('is-entering', 'is-risen');
  }

  /* ---------------------------------------------------------------- relevo plan → vuelo 1
     El vuelo 1 arranca nada más pulsar, debajo del plan. El texto del plan sube y se desenfoca
     (como la portada al salir) y la foto se funde sobre el espacio: los primeros segundos del vuelo,
     con el globo casi quieto, quedan bajo el fundido, y cuando el plan acaba de irse la Tierra
     ya se está acercando. Los tiempos están en deck.css (.is-handoff). */
  const HANDOFF_MS = 1700;
  let handoff = null;

  function startHandoff(slide) {
    slide.classList.add('is-handoff');
    stage.dataset.handoff = slide.id;
    handoff = { slide, timer: setTimeout(endHandoff, HANDOFF_MS) };
  }

  function endHandoff() {
    if (!handoff) return;
    clearTimeout(handoff.timer);
    // Se oculta de golpe (is-instant): sin el relevo su texto volvería a opacidad 1
    handoff.slide.classList.add('is-instant');
    handoff.slide.classList.remove('is-handoff');
    delete stage.dataset.handoff;
    handoff = null;
  }

  /* ---------------------------------------------------------------- pasos dentro de una diapositiva
     data-steps="N" en la diapositiva; cada hijo con data-at="k" aparece en el paso k
     y cada hijo con data-until="k" se va en el paso k. "Siguiente" avanza el paso antes de cambiar. */

  const stepsOf = (s) => Number(s.dataset.steps || 0);
  const stepOf = (s) => Number(s.dataset.step || 0);

  function setStep(slide, n) {
    slide.dataset.step = String(n);
    slide.querySelectorAll('[data-at]').forEach((el) => el.classList.toggle('is-shown', n >= Number(el.dataset.at)));
    slide.querySelectorAll('[data-until]').forEach((el) => el.classList.toggle('is-gone', n >= Number(el.dataset.until)));
    // data-rail-from-step="k": desde el paso k la barra de partes se retira (un plano a pantalla completa no la quiere encima)
    if (slide.dataset.railFromStep && slide.classList.contains('is-active')) {
      stage.dataset.rail = n >= Number(slide.dataset.railFromStep) ? 'off' : 'progress';
    }
    emit();
  }

  /* ---------------------------------------------------------------- navegación */

  /* Antes de seguir, las fronteras y el cartel del vuelo se desvanecen; las chinchetas del vuelo 2
     se quedan porque continúan en el vuelo 3. Una segunda pulsación durante el desvanecimiento no espera. */
  const LEAVE_MS = 450;
  let leaving = null;

  function cancelLeaving() {
    if (!leaving) return;
    clearTimeout(leaving.timer);
    leaving.slide.classList.remove('is-leaving');
    leaving = null;
  }

  function fadeThenNext(slide) {
    slide.classList.add('is-leaving');
    leaving = {
      slide,
      timer: setTimeout(() => {
        leaving = null;
        if (slides[index] === slide) go(index + 1, 1);
      }, LEAVE_MS),
    };
  }

  function leave(slide) {
    slide.classList.remove('is-active', 'is-leaving');
    held = false;
    if (isFlight(slide)) {
      const v = videoOf(slide);
      v.pause();
      v.onended = null;
      if (slide.dataset.state === 'playing') slide.dataset.state = 'ready';
    }
    stopOrbit(slide);
  }

  function activate(slide, dir, flip) {
    slide.dataset.dir = dir > 0 ? 'fwd' : 'back';
    slide.classList.add('is-active');
    stage.dataset.slide = slide.id;
    stage.dataset.tone = slide.dataset.tone || (isFlight(slide) ? 'dark' : 'light');
    // El altímetro solo acompaña a los vuelos; en su hueco, el resto de partes muestran el progreso
    stage.dataset.rail = slide.dataset.rail || (isFlight(slide) ? 'alt' : (slide.dataset.section ? 'progress' : 'off'));
    setProgress(slide);
    if (history.replaceState) history.replaceState(null, '', `#${slide.id}`);

    if (isFlight(slide)) {
      if (dir > 0) play(slide);
      else { land(slide, true, true); }
    } else {
      setAltitude(altFor(slide));
      // Hacia atrás la diapositiva vuelve completa y sin animaciones de entrada
      if (dir < 0) {
        slide.classList.add('is-static');
        requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.remove('is-static')));
      }
      if (stepsOf(slide)) setStep(slide, dir > 0 ? 0 : stepsOf(slide));
    }
    if (slide.classList.contains('slide--situation')) startOrbit(slide, flip);
    emit();
  }

  function go(i, dir) {
    if (gate.active) { blocked(); return; }
    if (hooks.nav) hooks.nav();
    cancelLeaving();
    if (i < 0 || i >= slides.length || i === index) return;
    endHandoff();
    const from = slides[index];
    const to = slides[i];
    const flip = dir > 0 && from.id === 's-vol-4' && to.id === 's-situation' && !reduceMotion.matches;
    const seamless = dir > 0 && isFlight(from) && isFlight(to);
    const relay = dir > 0 && from.classList.contains('slide--plan') && isFlight(to);
    const instant = seamless || flip || relay;
    from.classList.toggle('is-instant', instant);
    to.classList.toggle('is-instant', instant);
    leave(from);
    if (relay) startHandoff(from);
    index = i;
    activate(to, dir, flip);
  }

  function next() {
    if (listMode) return;
    if (gate.active) { blocked(); return; }
    if (hooks.nav) hooks.nav();
    if (leaving) { go(index + 1, 1); return; }
    const s = slides[index];
    if (isFlight(s)) {
      if (s.dataset.state === 'playing') { land(s, true); return; }
      if (s.dataset.state !== 'landed') { play(s); return; }
      // solo hace falta esperar si hay algo que desvanecer (fronteras, cartel, chinchetas)
      if (index + 1 < slides.length && s.querySelector('.borders, .cartouche, .pins--track')) { fadeThenNext(s); return; }
    }
    if (stepOf(s) < stepsOf(s)) { setStep(s, stepOf(s) + 1); return; }
    go(index + 1, 1);
  }

  function prev() {
    if (listMode) return;
    if (gate.active) { blocked(); return; }
    if (hooks.nav) hooks.nav();
    const s = slides[index];
    if (stepOf(s) > 0 && !isFlight(s)) { setStep(s, stepOf(s) - 1); return; }
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
      // En modo lectura cada diapositiva se ve en su último paso
      if (list && stepsOf(s)) setStep(s, stepsOf(s));
      if (isFlight(s)) {
        const v = videoOf(s);
        v.pause();
        if (list) {
          restoreSources(v);
          v.preload = 'metadata';
          v.poster = v.dataset.endPoster || v.poster;
          s.dataset.state = 'landed';
          s.classList.add('is-landed');
          trackPins(s, Infinity);   // la lista muestra el último fotograma: chinchetas en su sitio final
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
      applyRate(v);
      v.onended = () => s.classList.remove('is-playing');
      v.play().catch(() => s.classList.remove('is-playing'));
    });
  });

  /* ---------------------------------------------------------------- entrada */

  /* Las demás teclas (N notas, I info, F pantalla completa, P presentador, T cronómetro, B negro)
     son de js/chrome.js y js/presenter.js. Con un cuadro abierto (info, lista de pantallas) D.locked las frena. */
  document.addEventListener('keydown', (e) => {
    if (PRESENTER || window.DECK.locked) return;
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
      default:
    }
  });

  // Un clic en la diapositiva avanza (con Mayús, retrocede), salvo que cierre una selección de texto
  stage.addEventListener('click', (e) => {
    if (listMode) return;
    if (window.getSelection && String(window.getSelection())) return;
    if (e.shiftKey) prev(); else next();
  });

  let touchX = null;
  stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') touchX = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (touchX === null) return;
    const dx = e.clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50 && !listMode) { e.preventDefault(); if (dx < 0) next(); else prev(); }
  });

  // Escalonado del texto que entra tras el aterrizaje
  slides.forEach((s) => s.querySelectorAll('[data-rise]').forEach((el, i) => el.style.setProperty('--i', i)));

  if (!PRESENTER) window.addEventListener('resize', fit);

  /* ---------------------------------------------------------------- precarga completa de los vídeos
     En clase la wifi puede ser lenta: al abrir la página los vuelos se pasan a memoria y, hasta que están
     todos, la presentación no avanza (gate). La barra (js/chrome.js) enseña el progreso.
     - Los vídeos del HTML llevan preload="none": no se bajan dos veces (una por la etiqueta y otra por aquí).
     - Se guardan en Cache Storage («benicassim-videos-v1»), así que al recargar no se vuelven a bajar mientras no
       cambien: se pregunta al servidor con un HEAD (etag o tamaño + fecha) y, si coincide, se usa la copia guardada.
       Sin respuesta del servidor (sin red, proxy) se fía de lo guardado; si el archivo ha cambiado, se baja de nuevo.
     - Si una descarga falla se reintenta sin parar; solo entonces la barra ofrece «Commencer quand même»
       (D.release()), por si el aula tiene un proxy que lo impide. Sin fetch o desde file:// no hay precarga
       ni bloqueo: los vídeos se reproducen desde su URL. */

  const VIDEO_CACHE = 'benicassim-videos-v1';

  /* Las <source> del HTML llevan data-src, no src: así la etiqueta <video> no pide el archivo por su cuenta
     (con preload="none" Chrome aún abre una petición «Range: bytes=0-»). restoreSources las activa cuando
     hay que reproducir desde la URL: modo lectura, sin fetch, file:// o «Commencer quand même». */
  function playableSource(v) {
    const sources = Array.from(v.querySelectorAll('source'));
    for (const s of sources) {
      const type = s.getAttribute('type');
      if (!type || v.canPlayType(type)) return s.getAttribute('data-src') || s.getAttribute('src');
    }
    return null;
  }
  function restoreSources(v) {
    let changed = false;
    v.querySelectorAll('source[data-src]').forEach((el) => {
      el.setAttribute('src', el.getAttribute('data-src'));
      el.removeAttribute('data-src');
      changed = true;
    });
    if (changed && !v.getAttribute('src')) { try { v.load(); } catch (e) { /* sin vídeo, solo póster */ } }
  }
  // Lee la respuesta a trozos para poder contar los bytes; sin tamaño o sin lector, de una vez
  async function readBlob(res, onFrac) {
    const len = Number(res.headers.get('content-length')) || 0;
    if (!len || !res.body || !res.body.getReader) return res.blob();
    const type = res.headers.get('content-type');
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onFrac(Math.min(1, got / len));
    }
    return new Blob(chunks, type ? { type } : undefined);
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Qué versión es un archivo: etag (sin el W/ de débil) y, si no, tamaño y fecha de modificación
  const stamp = (h) => ({
    etag: (h.get('etag') || h.get('x-etag') || '').replace(/^W\//, ''),
    len: h.get('content-length') || h.get('x-length') || '',
    mod: h.get('last-modified') || h.get('x-modified') || '',
  });
  function sameVersion(a, b) {
    if (a.etag && b.etag) return a.etag === b.etag;
    if (a.len && b.len && a.len !== b.len) return false;
    if (a.mod && b.mod) return a.mod === b.mod;
    return Boolean(a.len && b.len);
  }
  // La copia guardada, si sigue valendo; null si no hay, está incompleta o el archivo ha cambiado
  async function fromStore(cache, src) {
    if (!cache) return null;
    try {
      const hit = await cache.match(src);
      if (!hit) return null;
      const mine = stamp(hit.headers);
      let same = true;   // sin respuesta del servidor, se fía de lo guardado
      try {
        const head = await Promise.race([fetch(src, { method: 'HEAD', cache: 'no-cache' }), wait(4000).then(() => null)]);
        if (head && head.ok) same = sameVersion(mine, stamp(head.headers));
      } catch (e) { /* sin red */ }
      if (!same) return null;
      const blob = await hit.blob();
      return mine.len && String(blob.size) !== mine.len ? null : blob;
    } catch (e) {
      return null;
    }
  }
  function toStore(cache, src, blob, res) {
    if (!cache) return;
    const h = res.headers;
    cache.put(src, new Response(blob, {
      headers: {
        'content-type': blob.type || h.get('content-type') || 'video/mp4',
        'x-etag': h.get('etag') || '',
        'x-length': String(blob.size),
        'x-modified': h.get('last-modified') || '',
      },
    })).catch(() => { /* cuota llena o almacenamiento desactivado: se queda solo en memoria */ });
  }

  async function preloadAll() {
    const videos = Array.from(stage.querySelectorAll('video'));
    if (!window.fetch || location.protocol === 'file:') {
      videos.forEach((v) => { restoreSources(v); v.preload = 'auto'; });
      return;
    }
    const jobs = videos.map((v) => [v, playableSource(v)]).filter(([, src]) => src);
    videos.forEach((v) => { if (!jobs.some(([j]) => j === v)) { restoreSources(v); v.preload = 'auto'; } });
    if (!jobs.length) return;
    Object.assign(gate, { running: true, active: true, total: jobs.length, done: 0, frac: 0, failed: false });
    jobs.forEach(([v]) => unswapped.add(v));
    emit();
    let lastStep = -1;
    const bump = () => {   // un aviso cada 2 % para no saturar a la barra ni al presentador
      const step = Math.floor(((gate.done + gate.frac) / gate.total) * 50);
      if (step !== lastStep) { lastStep = step; emit(); }
    };
    let cache = null;
    try { cache = 'caches' in window ? await caches.open(VIDEO_CACHE) : null; } catch (e) { cache = null; }
    const stored = await Promise.all(jobs.map(([, src]) => fromStore(cache, src)));

    for (let i = 0; i < jobs.length; i += 1) {
      const [v, src] = jobs[i];
      for (let attempt = 0; ; attempt += 1) {
        try {
          gate.frac = 0;
          let blob = stored[i];
          if (!blob) {
            const res = await fetch(src);
            if (!res.ok) throw new Error(String(res.status));
            blob = await readBlob(res, (f) => { gate.frac = f; bump(); });
            toStore(cache, src, blob, res);
          }
          const url = URL.createObjectURL(blob);
          const swap = () => {
            const t = v.currentTime;
            v.preload = 'auto';   // la copia está en memoria: cargarla no cuesta red
            v.src = url;
            applyRate(v);
            try { v.currentTime = t; } catch (e) { /* sin metadatos todavía */ }
            unswapped.delete(v);
          };
          if (v.paused) swap(); else v.addEventListener('pause', swap, { once: true });
          break;
        } catch (e) {
          stored[i] = null;
          gate.failed = true;
          emit();
          // Liberado a mano: se reintenta un par de veces más y se deja (el vídeo sigue con su URL normal)
          if (!gate.active && attempt >= 2) break;
          await wait(Math.min(5000, 800 * 2 ** attempt));
        }
      }
      gate.done += 1;
      gate.frac = 0;
      gate.failed = false;
      bump();
    }
    gate.running = false;
    gate.active = false;
    emit();
  }

  /* ---------------------------------------------------------------- arranque */

  /* Vista del orador (?presenter): todas las diapositivas se dejan como al final (vuelos aterrizados con
     su póster del último fotograma, fronteras y chinchetas dibujadas, todos los pasos), sin vídeos que bajar,
     y js/presenter.js las clona para las miniaturas. No se activa ninguna. */
  function preparePresenter() {
    root.classList.add('is-presenter');
    slides.forEach((s) => {
      s.querySelectorAll('video').forEach((v) => {
        v.pause();
        v.preload = 'none';
        v.removeAttribute('autoplay');
        v.querySelectorAll('source').forEach((src) => src.remove());
        v.removeAttribute('src');
        v.poster = v.dataset.endPoster || v.poster;
        try { v.load(); } catch (e) { /* sin vídeo, solo póster */ }
      });
      if (isFlight(s)) {
        s.dataset.state = 'landed';
        s.classList.add('is-landed', 'is-drawn');
        trackPins(s, Infinity);
      } else if (stepsOf(s)) {
        setStep(s, stepsOf(s));
      }
    });
  }

  window.DECK = {
    slides,
    notes,
    presenter: PRESENTER,
    locked: false,
    get index() { return index; },
    get step() { return stepOf(slides[index]); },
    get steps() { return stepsOf(slides[index]); },
    // 'playing' mientras corre el vídeo de un vuelo, 'landed' cuando ya ha aterrizado; '' en las demás
    get phase() { const s = slides[index]; return isFlight(s) ? (s.dataset.state || 'ready') : ''; },
    // null si no hay descarga en marcha; si la hay, cuánto va y si la navegación está frenada
    get loading() {
      if (!gate.running) return null;
      return { pct: Math.round(((gate.done + gate.frac) / gate.total) * 100), failed: gate.failed, blocking: gate.active };
    },
    release() {
      if (!gate.active) return;
      gate.active = false;
      unswapped.forEach((v) => { restoreSources(v); v.preload = 'auto'; });   // sin copia en memoria, que el vídeo se baje por su URL
      emit();
    },
    next, prev,
    goTo(i) { if (i !== index && i >= 0 && i < slides.length) go(i, i > index ? 1 : -1); },
    on(fn) { listeners.push(fn); },
    // El hook se llama al empezar cualquier navegación (la barra lo usa para quitar la pantalla en negro)
    set onNav(fn) { hooks.nav = fn; },
    // Pantalla en negro: el vuelo que corre se para y sigue donde estaba al volver
    hold(on) {
      const s = slides[index];
      if (!isFlight(s)) return;
      const v = videoOf(s);
      if (on) { if (s.dataset.state === 'playing' && !v.paused) { v.pause(); held = true; } }
      else if (held) { held = false; v.play().catch(() => {}); }
    },
  };

  buildBorders();
  buildPins();
  buildLabels();
  if (PRESENTER) {
    preparePresenter();
    return;
  }
  const fromHash = slides.findIndex((s) => `#${s.id}` === location.hash);
  index = fromHash > 0 ? fromHash : 0;
  fit();
  if (!listMode) {
    layoutRail();
    activate(slides[index], fromHash > 0 ? -1 : 1, false);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutRail);
  if (!listMode) preloadAll();
})();
