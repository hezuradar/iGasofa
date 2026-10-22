/* ==========================================================================
   iGasofa — capa base vectorial (Carto GL sobre MapLibre GL)

   MapLibre pinta el estilo vectorial de Carto en un lienzo propio y Leaflet
   queda por encima como motor de marcadores, grupos y popups. La cámara de
   ambos mapas se mantiene sincronizada.

   Todas las capas funcionan sin clave: Carto sirve su modalidad pública sin
   autenticación y el estilo vectorial incluye las URLs de teselas, glifos y
   sprite ya resueltas.
   ========================================================================== */
(() => {
  'use strict';

  const URL_STYLE_CARTO = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  const ATRIBUCION_CARTO =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const TIMEOUT_ESTILO_MS = 15000;

  /* Leaflet trabaja con teselas de 256 px y MapLibre con de 512 px: para
     el mismo tamaño en pantalla el zoom de MapLibre es una unidad menor. */
  const ML_ZOOM_OFFSET = Math.log2(256 / 512); // -1
  const zoomParaMapLibre = (z) => Math.max(0, z + ML_ZOOM_OFFSET);

  let promesaMapLibre = null;

  /** Carga perezosa del bundle de MapLibre (sólo si se usa la capa vectorial). */
  function cargarMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (promesaMapLibre) return promesaMapLibre;
    promesaMapLibre = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/maplibre/maplibre-gl.js';
      s.async = true;
      s.onload = () => (window.maplibregl
        ? resolve(window.maplibregl)
        : reject(new Error('MapLibre GL no está disponible')));
      s.onerror = () => {
        promesaMapLibre = null; // permite reintentar más tarde
        reject(new Error('no se pudo cargar MapLibre GL'));
      };
      document.head.appendChild(s);
    });
    return promesaMapLibre;
  }

  /** Espera a que MapLibre termine de cargar el estilo (o a que falle). */
  function esperarEstilo(ml) {
    return new Promise((resolve, reject) => {
      let resuelto = false;
      const fin = (accion, valor) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(temporizador);
        accion(valor);
      };
      const temporizador = setTimeout(() => fin(reject, new Error('tiempo de espera agotado')), TIMEOUT_ESTILO_MS);
      ml.on('style.load', () => fin(resolve));
      ml.on('error', (e) => {
        const mensaje = (e && e.error && e.error.message) || 'error al cargar el estilo';
        // Los fallos de una tesela suelta no invalidan un estilo ya cargado.
        if (ml.isStyleLoaded()) {
          console.warn('[carto-vector]', mensaje);
          return;
        }
        fin(reject, new Error(mensaje));
      });
    });
  }

  /**
   * Crea la capa Leaflet que gobierna el lienzo vectorial.
   * @param {{ contenedor: HTMLElement, envoltorio: HTMLElement, indicador: HTMLElement,
   *           obtenerClave: () => (string|null), alFallar: (mensaje: string) => void }} op
   */
  function crear(op) {
    let ml = null;
    let cargando = false;
    let mapa = null;
    // Número de intento de carga. Si el usuario cambia de capa mientras carga,
    // el intento en curso queda invalidado y no avisa.
    let generacion = 0;

    function urlEstilo() {
      const clave = op.obtenerClave();
      return clave ? `${URL_STYLE_CARTO}?key=${encodeURIComponent(clave)}` : URL_STYLE_CARTO;
    }

    /** Añade la clave de Carto a las peticiones de teselas, glifos y sprite. */
    function transformarPeticiones(url, tipo) {
      const clave = op.obtenerClave();
      if (!clave || url.indexOf('basemaps.cartocdn.com') < 0 || url.indexOf('key=') >= 0) return { url };
      if (tipo !== 'Tile' && tipo !== 'Glyphs' && tipo !== 'SpriteJSON' && tipo !== 'SpriteImage') return { url };
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      return { url: `${url}${sep}key=${encodeURIComponent(clave)}` };
    }

    function limpiar() {
      cargando = false;
      op.indicador.hidden = true;
      op.envoltorio.classList.remove('mapa-vector');
      if (ml) { try { ml.remove(); } catch { /* ignorado */ } }
      ml = null;
      op.contenedor.textContent = '';
    }

    async function activar() {
      if (ml || cargando) return;
      const intento = ++generacion;
      cargando = true;
      op.envoltorio.classList.add('mapa-vector');
      op.indicador.hidden = false;

      try {
        const maplibregl = await cargarMapLibre();
        if (intento !== generacion) return;
        const centro = mapa.getCenter();
        ml = new maplibregl.Map({
          container: op.contenedor,
          style: urlEstilo(),
          center: [centro.lng, centro.lat],
          zoom: zoomParaMapLibre(mapa.getZoom()),
          attributionControl: false,
          interactive: false,
          fadeDuration: 0,
          minZoom: 0,
          maxZoom: 24,
          transformRequest: transformarPeticiones,
        });

        await esperarEstilo(ml);
        if (intento !== generacion) return; // el usuario cambió de capa mientras cargaba
        cargando = false;
        op.indicador.hidden = true;
        sincronizar();
      } catch (err) {
        if (intento !== generacion) return; // ya no es la capa activa
        console.error('[carto-vector]', err);
        limpiar();
        op.alFallar(`No se pudo cargar el mapa vectorial (${err.message}). Se mantiene la capa raster.`);
      }
    }

    /** Mantiene la cámara de MapLibre alineada con la de Leaflet. */
    function sincronizar() {
      if (!ml || !mapa) return;
      const c = mapa.getCenter();
      try {
        ml.jumpTo({ center: [c.lng, c.lat], zoom: zoomParaMapLibre(mapa.getZoom()) });
      } catch {
        /* el mapa puede no estar listo todavía */
      }
    }

    const Capa = L.Layer.extend({
      getAttribution() { return ATRIBUCION_CARTO; },
      onAdd(m) {
        mapa = m;
        m.on('move zoom', sincronizar);
        activar();
      },
      onRemove(m) {
        m.off('move zoom', sincronizar);
        generacion++; // invalida cualquier carga en curso
        limpiar();
      },
    });

    const capa = new Capa();
    capa.redimensionar = () => {
      if (ml) { try { ml.resize(); } catch { /* ignorado */ } }
    };
    // Si llega una clave nueva con la capa en pantalla, se recarga el estilo
    // para que sus teselas la lleven también.
    capa.recargarEstilo = () => {
      if (ml) { try { ml.setStyle(urlEstilo()); } catch { /* ignorado */ } }
    };
    return capa;
  }

  window.iGasofaVector = { crear };
})();
