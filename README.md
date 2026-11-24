# Benicàssim · Présenter sa ville

Presentación oral de francés (FLE) sobre Benicàssim, con vuelos de Google Earth Studio que bajan del espacio a la playa.

**Ver la presentación:** https://alterbuild.github.io/benicassim/

## Cómo se usa

- **→, espacio, AvPág** o el mando de presentación: siguiente (también cada paso de una diapositiva). Durante un vuelo, salta al aterrizaje. **←, RePág**: anterior. **Inicio / Fin**: primera / última. Un clic en la diapositiva avanza; con Mayús, retrocede.
- La **barra** de abajo (aparece al mover el ratón) lleva anterior / puntos / contador / siguiente, **Notes** (N), **Présentateur** (P), **Plein écran** (F) e **Info** (I). Los puntos saltan a cualquier diapositiva.
- **N**: notas del orador sobre la diapositiva. Son tu guion en francés (`js/notes.js`); lo que va entre [corchetes] es cuándo pulsar →.
- **P** (o «Présentateur»): abre la **vista del orador** en otra ventana, con la diapositiva actual, la siguiente, las notas (que bajan solas al ritmo previsto), el cronómetro y todas las miniaturas. Se arrastran, se redimensionan y hay diseños con las teclas 1 a 7 (menú Paneles). Desde ahí también se avanza. Las dos ventanas tienen que estar en el **mismo navegador**.
- **T**: cronómetro discreto en la pantalla de la sala. **B** o **.**: pantalla en negro (un vuelo en marcha se para; cualquier avance la quita). **F**: pantalla completa; en Chrome o Edge con dos monitores deja elegir el proyector.
- Con dos monitores: extiende la pantalla (no la dupliques), abre la presentación en el proyector y pulsa **P**.
- El cronómetro empieza en **9:00** (editable, con la rueda dentada) y arranca solo al salir de la portada.
- Al abrirla, la web descarga los vídeos de los vuelos y **no deja avanzar hasta que están todos** (teclas, clics, puntos y presentador quedan frenados; la barra enseña el progreso y dice «Vidéos prêtes» al acabar). Si una descarga falla, reintenta sola y la barra ofrece «Commencer quand même». Los vídeos se guardan en el navegador (Cache Storage): al recargar no se vuelven a bajar mientras no cambien (la página pregunta al servidor con un HEAD y solo baja de nuevo el que haya cambiado; sin red usa lo guardado). Vale para el mismo navegador y perfil, no en una ventana privada. La primera vez en un ordenador, abre la página con tiempo: son unos 50 MB.

Funciona en Chrome, Edge, Firefox y Safari, en Windows y en Mac. En móvil se ve como una lista de diapositivas.

La vista del orador y la barra vienen de la presentación de International Business (sin el mando por móvil, que necesita un servidor): `js/chrome.js` (barra, notas, info), `js/presenter.js` (vista del orador, cronómetro, negro, pantalla completa), `css/chrome.css`, `css/presenter.css`.

## Créditos

Vuelos: Google Earth Studio (Data SIO, NOAA, U.S. Navy, Landsat / Copernicus, Airbus). Límites: IGN vía geoBoundaries y OpenStreetMap. Fotos: Wikimedia Commons, con autor y licencia en la última diapositiva.

Gatitos bailando de la última pantalla de la semana: stickers de GIPHY (fondo transparente), guardados en `media/gatos/`.
