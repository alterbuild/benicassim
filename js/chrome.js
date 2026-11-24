/* Benicàssim · mandos de la ventana del proyector
   Barra (anterior, puntos, contador, siguiente), notas (N) e info (I). Escucha a window.DECK (js/deck.js).
   El presentador, el cronómetro, la pantalla en negro y la pantalla completa (P, T, B, F) están en js/presenter.js.
   Adaptado de los mandos de la presentación de International Business. */
(() => {
  'use strict';

  const D = window.DECK;
  if (!D) return;

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Texto de las notas: un párrafo por línea; lo que va entre [corchetes] es una indicación (cuándo pulsar →), no se lee. */
  D.noteHtml = (text) => text.split('\n').map((line) => (
    '<p>' + esc(line).replace(/\[([^\]]+)\]/g, '<span class="cue">$1</span>') + '</p>'
  )).join('');

  if (D.presenter) return;   // la vista del orador tiene sus propios paneles

  const root = document.documentElement;
  const $ = (sel, from = document) => from.querySelector(sel);
  const ctrl = $('#ctrl');
  const dotsBox = $('#dots');
  const count = $('#count');
  const N = D.slides.length;

  /* ---------------------------------------------------------------- barra */

  dotsBox.innerHTML = D.slides.map((s, i) => {
    const t = D.notes[i].title;
    return `<button type="button" aria-label="Diapositive ${i + 1} : ${esc(t)}" title="${i + 1}. ${esc(t)}"></button>`;
  }).join('');
  const dots = Array.from(dotsBox.children);
  dots.forEach((d, i) => d.addEventListener('click', () => D.goTo(i)));
  $('#b-prev').addEventListener('click', () => D.prev());
  $('#b-next').addEventListener('click', () => D.next());

  // Tras un clic con el ratón el botón suelta el foco: así la barra espaciadora sigue avanzando la presentación
  ctrl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && e.detail > 0) b.blur();
  });

  // La barra aparece al mover el ratón y se esconde sola (nunca mientras el puntero está encima)
  let hideTimer = 0;
  function wake() {
    ctrl.classList.add('is-visible');
    root.classList.remove('is-idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function rest() {
      if (ctrl.matches(':hover')) { hideTimer = setTimeout(rest, 800); return; }
      ctrl.classList.remove('is-visible');
      root.classList.add('is-idle');
    }, 2400);
  }
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });

  /* ---------------------------------------------------------------- notas (N) */

  const notesBox = $('#notes');
  const notesBtn = $('#b-notes');
  function renderNotes() {
    const n = D.notes[D.index];
    const mins = n.sec ? ` · environ ${Math.floor(n.sec / 60)}:${String(n.sec % 60).padStart(2, '0')}` : '';
    $('#notes-h').textContent = `Diapositive ${D.index + 1} · ${n.title}${mins}`;
    $('#notes-t').innerHTML = n.text ? D.noteHtml(n.text) : '<p class="none">Pas de notes pour cette diapositive.</p>';
    notesBox.scrollTop = 0;
  }
  function toggleNotes() {
    notesBox.hidden = !notesBox.hidden;
    notesBtn.setAttribute('aria-pressed', String(!notesBox.hidden));
    if (!notesBox.hidden) renderNotes();
  }
  notesBtn.addEventListener('click', toggleNotes);

  /* ---------------------------------------------------------------- info (I)
     Con la ficha abierta las teclas de la presentación se paran (D.locked). Se cierra con Esc, I, la cruz o un clic fuera. */

  const infoEl = $('#info');
  const infoBtn = $('#b-info');
  let infoFrom = null;
  function infoKey(e) {
    if (e.key === 'Escape' || e.key === 'i' || e.key === 'I') { e.preventDefault(); e.stopPropagation(); infoClose(); return; }
    if (e.key === 'Tab') {
      const f = Array.from(infoEl.querySelectorAll('button, a[href]'));
      const k = f.indexOf(document.activeElement);
      e.preventDefault(); e.stopPropagation();
      f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }
  function infoOpen() {
    if (!infoEl.hidden) return;
    infoFrom = document.activeElement;
    infoEl.hidden = false;
    infoBtn.setAttribute('aria-expanded', 'true');
    D.locked = true;
    $('.info-x', infoEl).focus();
    document.addEventListener('keydown', infoKey, true);
  }
  function infoClose() {
    if (infoEl.hidden) return;
    infoEl.hidden = true;
    infoBtn.setAttribute('aria-expanded', 'false');
    D.locked = false;
    document.removeEventListener('keydown', infoKey, true);
    if (infoFrom && infoFrom !== document.body && infoFrom.isConnected) infoFrom.focus();
  }
  infoBtn.addEventListener('click', () => (infoEl.hidden ? infoOpen() : infoClose()));
  infoEl.addEventListener('click', (e) => { if (e.target === infoEl) infoClose(); });
  $('.info-x', infoEl).addEventListener('click', infoClose);

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || D.locked) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') toggleNotes();
    else if (e.key === 'i' || e.key === 'I') infoOpen();
  });

  /* ---------------------------------------------------------------- carga de los vídeos
     Hasta que están todos en memoria la presentación no avanza (js/deck.js). Mientras tanto la barra se queda
     a la vista con el progreso, y anterior, siguiente y los puntos se apagan. Solo si la descarga falla
     aparece «Commencer quand même». Al terminar dice «Vidéos prêtes». */

  const statusEl = $('#preload');
  const forceBtn = $('#b-force');
  const navBtns = [$('#b-prev'), $('#b-next'), ...dots];
  let wasLoading = false;
  let lastPct = -1;
  let lastFailed = null;
  function renderLoading() {
    const ld = D.loading;
    const blocking = !!(ld && ld.blocking);
    ctrl.classList.toggle('is-loading', !!ld);
    ctrl.setAttribute('aria-busy', String(blocking));
    navBtns.forEach((b) => { b.disabled = blocking; });
    forceBtn.hidden = !(blocking && ld.failed);
    if (ld) {
      if (ld.pct !== lastPct || ld.failed !== lastFailed) {
        lastPct = ld.pct;
        lastFailed = ld.failed;
        const text = ld.failed ? 'Vidéo non chargée · nouvelle tentative…' : `Chargement des vidéos · ${ld.pct}\u00a0%`;
        statusEl.classList.remove('is-done');
        statusEl.innerHTML = `<span>${text}</span><span class="ctrl-status__bar" aria-hidden="true"><i style="--p:${(ld.pct / 100).toFixed(3)}"></i></span>`;
      }
      wasLoading = true;
    } else if (wasLoading) {
      wasLoading = false;
      statusEl.classList.add('is-done');
      statusEl.textContent = 'Vidéos prêtes';
    }
  }
  forceBtn.addEventListener('click', () => D.release());

  /* ---------------------------------------------------------------- al cambiar de diapositiva */

  function render() {
    const i = D.index;
    count.textContent = `${i + 1} / ${N}`;
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    if (!notesBox.hidden) renderNotes();
  }
  let lastIndex = -1;
  D.on(() => {
    // Los pasos, el vuelo y la descarga también avisan; las notas solo cambian al cambiar de diapositiva
    renderLoading();
    if (D.index !== lastIndex) { lastIndex = D.index; render(); }
  });
  render();
  renderLoading();
  lastIndex = D.index;
  wake();
})();
