/* ==========================================================================
   iGasofa — lógica de la aplicación
   Depende de: Leaflet, mapa-vector.js (window.iGasofaVector) y
   horario.js (window.iGasofaHorario).
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Estado
   * ------------------------------------------------------------------ */
  const PRODUCTO_DEFECTO = 'GOA';
  const RADIO_DEFECTO = 10;
  const DEPOSITO_DEFECTO = 50;
  const RADIOS = [2, 5, 10, 15, 25, 50];
  const CLAVE_PREFS = 'igasofa:prefs';
  const MIN_PRECIOS_TRAMOS = 4; // con menos precios no tiene sentido hablar de caro/barato
  const BARRAS_HISTOGRAMA = 14;

  const estado = {
    productos: [],
    porClave: new Map(),
    estaciones: [],
    busqueda: null, // { tipo: 'cp', cp } | { tipo: 'coords', lat, lon }
    centro: null,
    centroNombre: '',
    producto: PRODUCTO_DEFECTO,
    radio: RADIO_DEFECTO,
    radioMostrado: RADIO_DEFECTO, // radio de los resultados en pantalla
    orden: 'distancia',
    soloConProducto: false,
    soloAbiertas: false,
    deposito: DEPOSITO_DEFECTO,
    stats: null,
    horarios: new Map(),
    seleccionada: null,
    popupId: null,
    repintando: false,
    peticion: 0,
    capa: null,
    capaVector: null,
    marcadores: new Map(),
    mapa: null,
    marcadorUsuario: null,
    carto: { clave: null },
    ultimaCapaRaster: null,
    capaCallejero: null,
  };

  const $ = (sel) => document.querySelector(sel);

  const ELEMENTOS = {
    formBuscar: $('#form-buscar'),
    inputCp: $('#input-cp'),
    btnUbicacion: $('#btn-ubicacion'),
    btnUbicacion2: $('#btn-ubicacion-2'),
    formCp2: $('#form-cp-2'),
    inputCp2: $('#input-cp-2'),
    vacio: $('#vacio'),
    panelBody: $('#panel-body'),
    resumen: $('#resumen'),
    selectProducto: $('#select-producto'),
    selectRadio: $('#select-radio'),
    selectOrden: $('#select-orden'),
    chkSolo: $('#chk-solo'),
    chkAbiertas: $('#chk-abiertas'),
    inputDeposito: $('#input-deposito'),
    contador: $('#contador'),
    notaOrden: $('#nota-orden'),
    lista: $('#lista'),
    mapa: $('#mapa'),
    mapaFondo: $('#mapa-fondo'),
    mapaCargando: $('#mapa-cargando'),
    mapaWrap: $('.mapa-wrap'),
    aviso: $('#aviso'),
    estado: $('#estado'),
    estadoTexto: $('#estado-texto'),
    btnMapa: $('#btn-mapa'),
  };

  /* ------------------------------------------------------------------ *
   * Preferencias (localStorage) y estado compartible (URL)
   * ------------------------------------------------------------------ */
  function leerPrefs() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_PREFS)) || {};
    } catch {
      return {};
    }
  }

  function guardarPrefs() {
    const prefs = {
      producto: estado.producto,
      radio: estado.radio,
      orden: estado.orden,
      soloConProducto: estado.soloConProducto,
      soloAbiertas: estado.soloAbiertas,
      deposito: estado.deposito,
      ultimoCp: estado.busqueda && estado.busqueda.tipo === 'cp' ? estado.busqueda.cp : leerPrefs().ultimoCp,
    };
    try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs)); } catch { /* modo privado */ }
  }

  /** Sólo el CP va a la URL: la ubicación exacta del usuario no se comparte. */
  function actualizarUrl() {
    const p = new URLSearchParams();
    // Mientras no haya una búsqueda resuelta se conserva el CP que traía la URL.
    const cp = estado.busqueda
      ? (estado.busqueda.tipo === 'cp' ? estado.busqueda.cp : null)
      : new URLSearchParams(location.search).get('cp');
    if (cp) p.set('cp', cp);
    if (estado.producto !== PRODUCTO_DEFECTO) p.set('producto', estado.producto);
    if (estado.radio !== RADIO_DEFECTO) p.set('radio', String(estado.radio));
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function aplicarPrefsIniciales() {
    const prefs = leerPrefs();
    const url = new URLSearchParams(location.search);
    const producto = url.get('producto') || prefs.producto;
    if (producto && estado.porClave.has(producto)) estado.producto = producto;
    const radio = [url.get('radio'), prefs.radio].map(Number).find((r) => RADIOS.includes(r));
    if (radio) estado.radio = radio;
    if (['distancia', 'precio', 'precio-desc'].includes(prefs.orden)) estado.orden = prefs.orden;
    estado.soloConProducto = Boolean(prefs.soloConProducto);
    estado.soloAbiertas = Boolean(prefs.soloAbiertas);
    estado.deposito = leerDeposito(prefs.deposito);

    ELEMENTOS.selectRadio.value = String(estado.radio);
    ELEMENTOS.selectOrden.value = estado.orden;
    ELEMENTOS.chkSolo.checked = estado.soloConProducto;
    ELEMENTOS.chkAbiertas.checked = estado.soloAbiertas;
    ELEMENTOS.inputDeposito.value = String(estado.deposito);

    const cp = limpiarCp(url.get('cp') || '');
    const ultimo = limpiarCp(prefs.ultimoCp || '');
    if (/^\d{5}$/.test(ultimo)) ELEMENTOS.inputCp.value = ELEMENTOS.inputCp2.value = ultimo;
    return /^\d{5}$/.test(cp) ? cp : null;
  }

  /* ------------------------------------------------------------------ *
   * Utilidades
   * ------------------------------------------------------------------ */
  const fmtPrecio = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const fmtEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  const precio = (v) => fmtPrecio.format(v);
  const euros = (v) => fmtEuros.format(v);
  const limpiarCp = (cp) => String(cp || '').trim().replace(/\s+/g, '');

  function leerDeposito(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 5 && n <= 200 ? n : DEPOSITO_DEFECTO;
  }

  function distancia(km) {
    if (km === null || km === undefined) return '—';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
    return `${Math.round(km)} km`;
  }

  function el(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  function boton(clase, texto, alPulsar) {
    const b = el('button', clase, texto);
    b.type = 'button';
    b.addEventListener('click', alPulsar);
    return b;
  }

  function aviso(mensaje, tipo = '') {
    ELEMENTOS.aviso.textContent = mensaje;
    ELEMENTOS.aviso.className = `aviso ${tipo}`.trim();
    ELEMENTOS.aviso.hidden = false;
    clearTimeout(aviso._t);
    aviso._t = setTimeout(() => { ELEMENTOS.aviso.hidden = true; }, 5200);
  }

  function nombreProducto(clave = estado.producto) {
    const p = estado.porClave.get(clave);
    return p ? p.nombre : clave;
  }

  /** "20560, Oñati, Debagoiena, Gipuzkoa, País Vasco, España" → "Oñati, Debagoiena". */
  function nombreCorto(nombre) {
    const partes = String(nombre || '').split(',').map((s) => s.trim()).filter((s) => s && !/^\d{5}$/.test(s));
    return partes.slice(0, 2).join(', ');
  }

  function colorMarca(nombre) {
    const marcas = {
      REPSOL: '#f4b400', CEPSA: '#00a0df', MOEVE: '#00a0df', BP: '#f6a600',
      GALP: '#00a19a', SHELL: '#ffd400', IBERDROLA: '#00a0df', ENI: '#ffdc00',
      TOTAL: '#e63329', Q8: '#e30613', CARREFOUR: '#004e9e', ELCARTE: '#0b6fb4',
      PETROPRIX: '#6a4c93', AVIA: '#005baa', MOLGAS: '#0f9d58', BALLENOIL: '#0072bc',
      PLENOIL: '#e2001a', PLENERGY: '#ff6b00', PETRONOR: '#f4b400', ALCAMPO: '#e2001a',
    };
    const n = (nombre || '').toUpperCase();
    for (const [k, v] of Object.entries(marcas)) {
      if (n.includes(k)) return v;
    }
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
    return `hsl(${h} 42% 42%)`;
  }

  function iniciales(nombre) {
    const limpio = (nombre || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    const partes = limpio.split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  function enlaceGoogle(destino, modo) {
    const { lat, lon } = destino;
    if (modo === 'ruta') return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  }

  const reducirMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pantallaEstrecha = () => window.matchMedia('(max-width: 900px)').matches;

  /* ------------------------------------------------------------------ *
   * Análisis de precios y horarios
   * ------------------------------------------------------------------ */
  const valorDe = (est) => est.precios[estado.producto];
  const tienePrecio = (est) => typeof valorDe(est) === 'number';

  /** Las de venta restringida ("R") sólo despachan a socios: no cuentan como mejor precio. */
  const esPublica = (est) => est.tipoVenta !== 'R';

  function horarioDe(est) {
    return estado.horarios.get(est.id) || { abierta: null, h24: false };
  }

  function calcularHorarios() {
    const ahora = new Date();
    estado.horarios = new Map(
      estado.estaciones.map((e) => [e.id, window.iGasofaHorario.estadoEn(e.horario, ahora)])
    );
  }

  function cuantil(ordenados, q) {
    const pos = (ordenados.length - 1) * q;
    const base = Math.floor(pos);
    const resto = pos - base;
    const siguiente = ordenados[base + 1] === undefined ? ordenados[base] : ordenados[base + 1];
    return ordenados[base] + resto * (siguiente - ordenados[base]);
  }

  function histograma(valores, min, max) {
    const barras = Math.min(BARRAS_HISTOGRAMA, valores.length);
    const ancho = (max - min) / barras || 1;
    const cuentas = new Array(barras).fill(0);
    for (const v of valores) cuentas[Math.min(barras - 1, Math.floor((v - min) / ancho))]++;
    return cuentas.map((n, i) => ({ n, centro: min + ancho * (i + 0.5) }));
  }

  /** Mejor precio, media y tramos sobre las gasolineras públicas (y abiertas, si se filtra). */
  function calcularEstadisticas() {
    const candidatas = estado.estaciones.filter((e) =>
      tienePrecio(e) && esPublica(e) && !(estado.soloAbiertas && horarioDe(e).abierta === false));
    if (!candidatas.length) return null;

    let mejor = candidatas[0];
    for (const e of candidatas) {
      if (valorDe(e) < valorDe(mejor) || (valorDe(e) === valorDe(mejor) && e.distancia < mejor.distancia)) mejor = e;
    }
    const valores = candidatas.map(valorDe).sort((a, b) => a - b);
    const min = valores[0];
    const max = valores[valores.length - 1];
    const media = valores.reduce((s, v) => s + v, 0) / valores.length;
    const conTramos = valores.length >= MIN_PRECIOS_TRAMOS && max - min > 0.0005;
    return {
      mejor: { id: mejor.id, est: mejor, precio: valorDe(mejor) },
      n: valores.length,
      min,
      max,
      media,
      p33: conTramos ? cuantil(valores, 1 / 3) : null,
      p66: conTramos ? cuantil(valores, 2 / 3) : null,
      histograma: histograma(valores, min, max),
    };
  }

  function tramo(valor) {
    const s = estado.stats;
    if (!s || s.p33 === null || typeof valor !== 'number') return '';
    if (valor <= s.p33) return 'barato';
    if (valor <= s.p66) return 'medio';
    return 'caro';
  }

  const TEXTO_TRAMO = { barato: 'precio bajo', medio: 'precio medio', caro: 'precio alto' };

  function textoHorario(h, est) {
    if (h.h24) return { clase: 'abierta', texto: '24 h' };
    if (h.abierta === true) return { clase: 'abierta', texto: `Abierta · cierra ${h.hasta}` };
    if (h.abierta === false) return { clase: 'cerrada', texto: h.abre ? `Cerrada · abre ${h.abre}` : 'Cerrada' };
    return est.horario ? { clase: '', texto: est.horario } : null;
  }

  function estacionesVisibles() {
    let lista = estado.estaciones.slice();
    if (estado.soloConProducto) lista = lista.filter(tienePrecio);
    if (estado.soloAbiertas) lista = lista.filter((e) => horarioDe(e).abierta !== false);

    if (estado.orden === 'precio' || estado.orden === 'precio-desc') {
      const dir = estado.orden === 'precio' ? 1 : -1;
      lista.sort((a, b) => {
        const pa = valorDe(a);
        const pb = valorDe(b);
        if (typeof pa !== 'number' && typeof pb !== 'number') return a.distancia - b.distancia;
        if (typeof pa !== 'number') return 1;
        if (typeof pb !== 'number') return -1;
        if (pa !== pb) return (pa - pb) * dir;
        return a.distancia - b.distancia;
      });
    } else {
      lista.sort((a, b) => a.distancia - b.distancia);
    }
    return lista;
  }

  /* ------------------------------------------------------------------ *
   * Mapa
   * ------------------------------------------------------------------ */
  function redimensionarMapa() {
    estado.mapa.invalidateSize();
    if (estado.capaVector) estado.capaVector.redimensionar();
  }

  /** Si la capa vectorial falla, se vuelve a la última capa raster usada. */
  function volverACapaRaster(mensaje) {
    aviso(mensaje, 'error');
    const anterior = estado.ultimaCapaRaster || estado.capaCallejero;
    if (estado.mapa.hasLayer(estado.capaVector)) estado.mapa.removeLayer(estado.capaVector);
    if (anterior && !estado.mapa.hasLayer(anterior)) estado.mapa.addLayer(anterior);
  }

  function crearMapa() {
    const mapa = L.map(ELEMENTOS.mapa, { center: [40.4637, -3.7492], zoom: 6, zoomControl: true, attributionControl: true });
    estado.mapa = mapa;

    estado.capaVector = window.iGasofaVector.crear({
      contenedor: ELEMENTOS.mapaFondo,
      envoltorio: ELEMENTOS.mapaWrap,
      indicador: ELEMENTOS.mapaCargando,
      obtenerClave: () => estado.carto.clave,
      alFallar: volverACapaRaster,
    });

    const capas = {
      'Estilo Google · Vector': estado.capaVector,
      'Callejero': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }),
      'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics',
      }),
    };

    // Capa de reserva: si la vectorial no puede cargarse se cae a esta.
    estado.capaCallejero = capas['Callejero'];
    estado.capaVector.addTo(mapa);

    L.control.layers(capas, null, { position: 'topright', collapsed: true }).addTo(mapa);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);

    estado.capa = L.layerGroup().addTo(mapa);
    mapa.on('layeradd', (e) => {
      if (e.layer instanceof L.TileLayer) estado.ultimaCapaRaster = e.layer;
    });
    // Al acercar se muestran más precios y al alejar menos, para que no se
    // solapen. `moveend` también se emite al terminar un zoom.
    mapa.on('moveend', programarRepintado);
    return mapa;
  }

  /* El autoPan de un popup emite `moveend` mientras el popup aún se está
     abriendo: repintar en ese momento lo destruiría a medias. Se aplaza y se
     agrupan los movimientos seguidos en un solo repintado. */
  let repintadoPendiente = false;
  function programarRepintado() {
    if (repintadoPendiente) return;
    repintadoPendiente = true;
    setTimeout(() => {
      repintadoPendiente = false;
      pintarMarcadores();
    }, 0);
  }

  function marcarUsuario(lat, lon) {
    if (estado.marcadorUsuario) {
      estado.marcadorUsuario.setLatLng([lat, lon]);
      return;
    }
    estado.marcadorUsuario = L.marker([lat, lon], {
      icon: L.divIcon({ className: 'pin', html: '<div class="pin-yo"></div>', iconSize: [16, 16], iconAnchor: [0, 0] }),
      zIndexOffset: 1000,
      interactive: false,
      keyboard: false,
      title: 'Tu ubicación',
    }).addTo(estado.mapa);
    const nodo = estado.marcadorUsuario.getElement();
    if (nodo) {
      nodo.setAttribute('role', 'img');
      nodo.setAttribute('aria-label', 'Tu ubicación');
    }
  }

  /** Nombre accesible y título para los marcadores (Leaflet no los genera). */
  function etiquetarMarcador(marcador, texto) {
    const nodo = marcador.getElement();
    if (!nodo) return;
    nodo.setAttribute('aria-label', texto);
    nodo.setAttribute('title', texto);
  }

  function descripcionMarcador(est, valor, esMejor) {
    const conPrecio = typeof valor === 'number';
    const visible = conPrecio ? `${esMejor ? '★' : ''}${precio(valor)}` : '';
    const detalle = [
      est.rotulo,
      est.municipio || est.localidad,
      distancia(est.distancia),
      conPrecio ? nombreProducto() : 'sin precio publicado',
      esMejor ? 'mejor precio de la zona' : TEXTO_TRAMO[tramo(valor)],
      horarioDe(est).abierta === false ? 'cerrada ahora' : '',
    ].filter(Boolean);
    return visible ? `${visible} — ${detalle.join(', ')}` : detalle.join(', ');
  }

  function iconoPrecio(est, valor, esMejor) {
    const clases = ['pin-precio'];
    if (esMejor) clases.push('mejor');
    else if (tramo(valor)) clases.push(`t-${tramo(valor)}`);
    if (horarioDe(est).abierta === false) clases.push('cerrada');
    const estrella = esMejor ? '<span class="pin-estrella" aria-hidden="true">★</span>' : '';
    return L.divIcon({
      className: 'pin',
      html: `<div class="${clases.join(' ')}">${estrella}${precio(valor)}</div>`,
      iconSize: null,
      iconAnchor: [0, 0],
    });
  }

  function iconoSinPrecio() {
    return L.divIcon({ className: 'pin', html: '<div class="pin-sin-precio"></div>', iconSize: [24, 24], iconAnchor: [0, 0] });
  }

  function iconoCluster(cantidad, minPrecio) {
    const tam = cantidad > 99 ? 42 : cantidad > 9 ? 36 : 30;
    // El precio mínimo se pinta con un pseudo-elemento: así el texto visible
    // del marcador es sólo el número y el nombre accesible lo describe entero.
    const dato = typeof minPrecio === 'number' ? ` data-precio="${precio(minPrecio)} €"` : '';
    const clase = tramo(minPrecio) ? ` t-${tramo(minPrecio)}` : '';
    return L.divIcon({
      className: 'pin',
      html: `<div class="pin-cluster${clase}" style="--tam:${tam}px"${dato}><span class="cluster-n">${cantidad}</span></div>`,
      iconSize: [tam, tam],
      iconAnchor: [0, 0],
    });
  }

  function contenidoPopup(est) {
    const cont = el('div', 'popup');
    cont.appendChild(el('div', 'popup-titulo', est.rotulo));
    cont.appendChild(el('div', 'popup-sub',
      `${est.direccion}${est.municipio ? ' · ' + est.municipio : ''} — ${distancia(est.distancia)}`));

    const h = textoHorario(horarioDe(est), est);
    if (h) cont.appendChild(el('div', `popup-horario ${h.clase}`, h.texto));
    if (!esPublica(est)) cont.appendChild(el('div', 'popup-aviso', 'Venta restringida a socios o clientes autorizados'));

    const productos = estado.productos
      .filter((p) => typeof est.precios[p.key] === 'number')
      .sort((a, b) => a.orden - b.orden);
    if (productos.length) {
      const tabla = el('table', 'popup-tabla');
      for (const p of productos) {
        const fila = el('tr', p.key === estado.producto ? 'popup-actual' : null);
        fila.append(el('td', null, p.nombre), el('td', null, `${precio(est.precios[p.key])} €/L`));
        tabla.appendChild(fila);
      }
      cont.appendChild(tabla);
    }

    const enlace = el('a', 'popup-enlace', 'Cómo llegar →');
    enlace.href = enlaceGoogle(est, 'ruta');
    enlace.target = '_blank';
    enlace.rel = 'noopener';
    cont.appendChild(enlace);
    return cont;
  }

  /**
   * Agrupa las estaciones en celdas de pantalla para evitar marcadores
   * superpuestos. Devuelve grupos con su centro geográfico.
   */
  function agruparPorPantalla(estaciones) {
    const tam = 74; // píxeles por celda
    const celdas = new Map();
    for (const est of estaciones) {
      const p = estado.mapa.latLngToContainerPoint([est.lat, est.lon]);
      const key = `${Math.floor(p.x / tam)}:${Math.floor(p.y / tam)}`;
      if (!celdas.has(key)) celdas.set(key, []);
      celdas.get(key).push(est);
    }
    return [...celdas.values()].map((grupo) => ({
      grupo,
      lat: grupo.reduce((s, e) => s + e.lat, 0) / grupo.length,
      lon: grupo.reduce((s, e) => s + e.lon, 0) / grupo.length,
    }));
  }

  function marcadorEstacion(est, esMejor) {
    const valor = valorDe(est);
    const conPrecio = typeof valor === 'number';
    const m = L.marker([est.lat, est.lon], {
      icon: conPrecio ? iconoPrecio(est, valor, esMejor) : iconoSinPrecio(),
      zIndexOffset: esMejor ? 1200 : conPrecio ? 0 : -100,
      riseOnHover: true,
    });
    m.bindPopup(() => contenidoPopup(est), { closeButton: false, offset: [0, conPrecio ? -4 : 0] });
    m.on('popupopen', () => {
      estado.popupId = est.id;
      // Al reabrirlo tras un repintado no se mueve la lista: el usuario puede estar usándola.
      resaltarTarjeta(est.id, !estado.repintando);
    });
    m.on('popupclose', () => {
      if (!estado.repintando && estado.popupId === est.id) estado.popupId = null;
    });
    m.addTo(estado.capa);
    etiquetarMarcador(m, descripcionMarcador(est, valor, esMejor));
    estado.marcadores.set(est.id, m);
    return m;
  }

  function marcadorGrupo(resto, lat, lon) {
    const conPrecio = resto.map(valorDe).filter((v) => typeof v === 'number');
    const minimo = conPrecio.length ? Math.min(...conPrecio) : null;
    const c = L.marker([lat, lon], { icon: iconoCluster(resto.length, minimo), zIndexOffset: 100 });
    c.on('click', () => {
      estado.mapa.setView([lat, lon], Math.min(18, estado.mapa.getZoom() + 2), { animate: !reducirMovimiento() });
    });
    c.addTo(estado.capa);
    etiquetarMarcador(c, `Grupo de ${resto.length} gasolineras` +
      (minimo !== null ? `, precio mínimo ${precio(minimo)} euros por litro` : '') + '. Pulsa para ampliar.');
  }

  function pintarMarcadores() {
    if (!estado.capa) return;
    // Al repintar se destruyen los marcadores: el popup abierto se recuerda
    // para volver a abrirlo en el marcador nuevo.
    estado.repintando = true;
    estado.capa.clearLayers();
    estado.marcadores.clear();

    const mejorId = estado.stats ? estado.stats.mejor.id : null;
    for (const { grupo, lat, lon } of agruparPorPantalla(estacionesVisibles())) {
      // La mejor gasolinera siempre se muestra aparte (se dibuja al final).
      const resto = mejorId ? grupo.filter((e) => e.id !== mejorId) : grupo;
      if (resto.length === 1) marcadorEstacion(resto[0], false);
      else if (resto.length > 1) marcadorGrupo(resto, lat, lon);
    }
    if (estado.stats) marcadorEstacion(estado.stats.mejor.est, true);

    const abierto = estado.popupId && estado.marcadores.get(estado.popupId);
    if (abierto) abierto.openPopup();
    estado.repintando = false;
  }

  function enfocar(est) {
    estado.popupId = est.id;
    estado.seleccionada = est.id;
    const zoom = estado.marcadores.has(est.id) ? Math.max(14, estado.mapa.getZoom()) : 16;
    if (reducirMovimiento()) estado.mapa.setView([est.lat, est.lon], zoom);
    else estado.mapa.flyTo([est.lat, est.lon], zoom, { duration: 0.7 });
    // `moveend` repinta y abre el popup; si el mapa no tuvo que moverse, se abre aquí.
    setTimeout(() => {
      const m = estado.marcadores.get(est.id);
      if (m && !m.isPopupOpen()) m.openPopup();
    }, 900);
    if (pantallaEstrecha()) ELEMENTOS.mapaWrap.scrollIntoView({ block: 'start', behavior: reducirMovimiento() ? 'auto' : 'smooth' });
  }

  /** Encuadra el mapa para que quepa todo el radio de búsqueda. */
  function encuadrar(centro, radioKm) {
    const limites = L.latLng(centro.lat, centro.lon).toBounds(radioKm * 1000);
    estado.mapa.fitBounds(limites, { padding: [36, 36], animate: !reducirMovimiento(), duration: 0.8 });
  }

  /* ------------------------------------------------------------------ *
   * Datos
   * ------------------------------------------------------------------ */
  async function pedir(url) {
    let r;
    try {
      r = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('No hay conexión con el servidor de iGasofa.');
    }
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch { cuerpo = null; }
    if (!r.ok || !cuerpo || cuerpo.ok === false) {
      throw new Error((cuerpo && cuerpo.error) || `Error ${r.status}`);
    }
    return cuerpo;
  }

  async function cargarProductos() {
    try {
      const d = await pedir('/api/productos');
      estado.productos = (d.productos || []).slice().sort((a, b) => a.orden - b.orden);
      estado.porClave = new Map(estado.productos.map((p) => [p.key, p]));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de productos', e);
      aviso('No se pudo cargar la lista de carburantes. Recarga la página.', 'error');
    }
  }

  function pintarEstado(clase, texto, titulo) {
    ELEMENTOS.estado.className = `estado ${clase}`;
    ELEMENTOS.estadoTexto.textContent = texto;
    if (titulo) ELEMENTOS.estado.title = titulo;
  }

  async function actualizarEstado() {
    try {
      const d = await pedir('/api/estado');
      aplicarClaveCarto(d.carto && d.carto.clave);
      if (d.fecha) {
        pintarEstado(d.error ? 'aviso' : 'listo', `Datos: ${d.fecha}`,
          d.error
            ? 'No se pudo refrescar: se muestran los últimos precios descargados'
            : `${d.estaciones} estaciones · Ministerio de Industria, Comercio y Turismo`);
      } else if (d.error) {
        pintarEstado('error', 'Sin datos', d.error);
      } else {
        pintarEstado('cargando', 'Cargando precios…');
      }
    } catch {
      pintarEstado('error', 'Sin conexión con el servidor');
    }
  }

  /**
   * Si el servidor tiene una clave de Carto (CARTO_KEY o config.json) se
   * aplica al estilo vectorial: teselas, glifos y sprite. Es opcional; sin
   * clave, Carto sirve la modalidad pública y todo funciona igual.
   */
  function aplicarClaveCarto(clave) {
    if (!clave || estado.carto.clave === clave) return;
    estado.carto.clave = clave;
    estado.capaVector.recargarEstilo();
  }

  function urlBusqueda(b) {
    return b.tipo === 'cp'
      ? `/api/postal/${b.cp}?radio=${estado.radio}`
      : `/api/estaciones?lat=${b.lat}&lon=${b.lon}&radio=${estado.radio}`;
  }

  /** Lanza una búsqueda; si llega otra antes de responder, ésta se descarta. */
  async function buscar(busqueda) {
    const turno = ++estado.peticion;
    const habiaResultados = estado.estaciones.length > 0;
    mostrarCargando();
    try {
      const d = await pedir(urlBusqueda(busqueda));
      if (turno !== estado.peticion) return;
      aplicarResultado(d, busqueda);
    } catch (e) {
      if (turno !== estado.peticion) return;
      aviso(e.message, 'error');
      if (habiaResultados) {
        // Se vuelve al radio de los resultados que siguen en pantalla.
        estado.radio = estado.radioMostrado;
        ELEMENTOS.selectRadio.value = String(estado.radio);
        guardarPrefs();
        actualizarUrl();
        render();
      } else {
        mostrarVacio();
      }
      actualizarEstado();
    }
  }

  function buscarPorCp(cp) {
    const limpio = limpiarCp(cp);
    if (!/^\d{5}$/.test(limpio)) {
      aviso('El código postal debe tener 5 dígitos.', 'error');
      return;
    }
    ELEMENTOS.inputCp.value = ELEMENTOS.inputCp2.value = limpio;
    buscar({ tipo: 'cp', cp: limpio });
  }

  function aplicarResultado(datos, busqueda) {
    estado.estaciones = datos.estaciones || [];
    estado.busqueda = busqueda;
    estado.radioMostrado = estado.radio;
    estado.centro = datos.centro;
    estado.centroNombre = busqueda.tipo === 'cp'
      ? nombreCorto(datos.nombre) || `CP ${busqueda.cp}`
      : 'tu ubicación';
    estado.seleccionada = null;
    estado.popupId = null;

    if (estado.centro) encuadrar(estado.centro, estado.radio);
    if (datos.fecha) pintarEstado(datos.desactualizado ? 'aviso' : 'listo', `Datos: ${datos.fecha}`);
    if (datos.desactualizado) aviso('El Ministerio no responde: se muestran los últimos precios disponibles.', 'error');

    guardarPrefs();
    actualizarUrl();
    render();
  }

  /* ------------------------------------------------------------------ *
   * Búsqueda por ubicación
   * ------------------------------------------------------------------ */
  function estadoBotonUbicacion(buscando) {
    for (const b of [ELEMENTOS.btnUbicacion, ELEMENTOS.btnUbicacion2]) {
      b.classList.toggle('activo', buscando);
      b.setAttribute('aria-busy', String(buscando));
      b.querySelector('span').textContent = buscando ? 'Buscando…' : 'Usar mi ubicación';
    }
  }

  function pedirUbicacion() {
    if (!('geolocation' in navigator)) {
      aviso('Este navegador no soporta geolocalización. Usa el código postal.', 'error');
      return;
    }
    if (!window.isSecureContext) {
      aviso('La geolocalización necesita HTTPS o localhost. Usa el código postal.', 'error');
      return;
    }
    estadoBotonUbicacion(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        estadoBotonUbicacion(false);
        const { latitude, longitude } = pos.coords;
        marcarUsuario(latitude, longitude);
        buscar({ tipo: 'coords', lat: latitude, lon: longitude });
      },
      (err) => {
        estadoBotonUbicacion(false);
        aviso(err.code === 1
          ? 'Permiso de ubicación denegado. Introduce tu código postal.'
          : 'No se pudo obtener tu ubicación. Introduce tu código postal.', 'error');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ------------------------------------------------------------------ *
   * Renderizado
   * ------------------------------------------------------------------ */
  function mostrarVacio() {
    ELEMENTOS.vacio.hidden = false;
    ELEMENTOS.panelBody.hidden = true;
  }

  function mostrarCargando() {
    ELEMENTOS.vacio.hidden = true;
    ELEMENTOS.panelBody.hidden = false;
    ELEMENTOS.panelBody.setAttribute('aria-busy', 'true');
    pintarEstado('cargando', 'Buscando…');
    ELEMENTOS.resumen.textContent = '';
    ELEMENTOS.resumen.appendChild(el('div', 'resumen-card esqueleto'));
    ELEMENTOS.lista.textContent = '';
    for (let i = 0; i < 5; i++) ELEMENTOS.lista.appendChild(el('div', 'tarjeta esqueleto'));
    ELEMENTOS.contador.textContent = 'Buscando gasolineras…';
    ELEMENTOS.notaOrden.textContent = '';
  }

  function render() {
    ELEMENTOS.vacio.hidden = true;
    ELEMENTOS.panelBody.hidden = false;
    ELEMENTOS.panelBody.removeAttribute('aria-busy');
    calcularHorarios();
    estado.stats = calcularEstadisticas();
    renderProducto();
    renderResumen();
    renderLista();
    pintarMarcadores();
  }

  /* Selector de producto: un desplegable compacto con el número de gasolineras
     de la zona que publican ese precio. */
  function renderProducto() {
    const sel = ELEMENTOS.selectProducto;
    const firma = estado.productos.map((p) => p.key).join('|');
    if (sel.dataset.catalogo !== firma) {
      sel.textContent = '';
      const grupos = [['Principales', estado.productos.filter((p) => p.principal)],
        ['Otros carburantes', estado.productos.filter((p) => !p.principal)]];
      for (const [titulo, productos] of grupos) {
        const og = el('optgroup');
        og.label = titulo;
        for (const p of productos) {
          const op = el('option', null, p.nombre);
          op.value = p.key;
          og.appendChild(op);
        }
        sel.appendChild(og);
      }
      sel.dataset.catalogo = firma;
    }

    const conResultados = estado.estaciones.length > 0;
    for (const op of Array.from(sel.options)) {
      const nombre = nombreProducto(op.value);
      const n = estado.estaciones.filter((e) => typeof e.precios[op.value] === 'number').length;
      op.textContent = conResultados ? `${nombre} (${n})` : nombre;
    }
    sel.value = estado.producto;
  }

  function renderHistograma(s) {
    const cont = el('div', 'histo');
    const titulo = el('div', 'histo-titulo');
    titulo.append(el('span', null, `Precios en la zona · ${s.n} gasolineras`),
      el('span', null, `media ${precio(s.media)} €`));
    cont.appendChild(titulo);

    const barras = el('div', 'histo-barras');
    barras.setAttribute('aria-hidden', 'true');
    const maxN = Math.max(...s.histograma.map((b) => b.n));
    for (const b of s.histograma) {
      const barra = el('span', `histo-barra ${tramo(b.centro) ? 't-' + tramo(b.centro) : ''}`);
      barra.style.setProperty('--h', `${b.n ? Math.max(12, (b.n / maxN) * 100) : 4}%`);
      barras.appendChild(barra);
    }
    const marca = el('span', 'histo-media');
    marca.style.setProperty('--x', `${((s.media - s.min) / (s.max - s.min || 1)) * 100}%`);
    barras.appendChild(marca);
    cont.appendChild(barras);

    const ejes = el('div', 'histo-ejes');
    ejes.append(el('span', null, `${precio(s.min)} €`), el('span', null, `${precio(s.max)} €`));
    cont.appendChild(ejes);
    cont.appendChild(el('span', 'sr-only',
      `Precios entre ${precio(s.min)} y ${precio(s.max)} euros por litro; media ${precio(s.media)}.`));
    return cont;
  }

  function renderAhorro(s) {
    const litros = estado.deposito;
    const ah = el('div', 'resumen-ahorro');
    const fila = el('div', 'ahorro-fila');
    fila.append(el('span', null, `Llenar ${litros} L aquí`), el('strong', null, euros(s.mejor.precio * litros)));
    ah.appendChild(fila);
    const vsMedia = (s.media - s.mejor.precio) * litros;
    const vsMax = (s.max - s.mejor.precio) * litros;
    if (vsMax >= 0.01) {
      const detalle = el('div', 'ahorro-detalle');
      detalle.textContent = vsMedia >= 0.01
        ? `Ahorras ${euros(vsMedia)} frente a la media y ${euros(vsMax)} frente a la más cara.`
        : `Ahorras ${euros(vsMax)} frente a la más cara.`;
      ah.appendChild(detalle);
    }
    return ah;
  }

  async function compartir() {
    const s = estado.stats;
    const texto = s
      ? `${nombreProducto()} a ${precio(s.mejor.precio)} €/L en ${s.mejor.est.rotulo} (${s.mejor.est.municipio || s.mejor.est.localidad})`
      : 'Gasolineras cercanas en iGasofa';
    // Si se buscó por ubicación se comparte la gasolinera, nunca la posición del usuario.
    const porCp = estado.busqueda && estado.busqueda.tipo === 'cp';
    const url = porCp || !s ? location.href : enlaceGoogle(s.mejor.est);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'iGasofa', text: texto, url });
        return;
      }
      await navigator.clipboard.writeText(`${texto} · ${url}`);
      aviso('Enlace copiado al portapapeles.', 'ok');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // el usuario cerró el diálogo
      aviso('No se pudo compartir el enlace.', 'error');
    }
  }

  function renderResumen() {
    const cont = ELEMENTOS.resumen;
    cont.textContent = '';
    const s = estado.stats;

    if (!s) {
      const card = el('div', 'resumen-card sin-datos');
      card.appendChild(el('div', 'resumen-etiqueta', 'Sin datos'));
      card.appendChild(el('p', 'resumen-texto',
        `Ninguna gasolinera ${estado.soloAbiertas ? 'abierta ' : ''}en ${estado.radio} km publica precio de ${nombreProducto()}.`));
      cont.appendChild(card);
      return;
    }

    const est = s.mejor.est;
    const card = el('div', 'resumen-card');
    card.appendChild(el('div', 'resumen-etiqueta', `★ Mejor precio · ${nombreProducto()}`));

    const fila = el('div', 'resumen-fila');
    const bloquePrecio = el('div', 'resumen-precio');
    bloquePrecio.append(document.createTextNode(precio(s.mejor.precio)), el('small', null, ' €/L'));
    const datos = el('div', 'resumen-datos');
    datos.append(el('strong', null, est.rotulo), el('span', null,
      `${distancia(est.distancia)} · ${est.municipio || est.localidad || ''}`));
    const h = textoHorario(horarioDe(est), est);
    if (h) datos.appendChild(el('span', `resumen-horario ${h.clase}`, h.texto));
    fila.append(bloquePrecio, datos);
    card.appendChild(fila);

    card.appendChild(renderAhorro(s));
    if (s.n > 1) card.appendChild(renderHistograma(s));

    const acciones = el('div', 'resumen-accion');
    acciones.append(
      boton('btn', 'Ver en el mapa', () => enfocar(est)),
      boton('btn', 'Cómo llegar', () => window.open(enlaceGoogle(est, 'ruta'), '_blank', 'noopener')),
      boton('btn', 'Compartir', compartir)
    );
    card.appendChild(acciones);
    cont.appendChild(card);
  }

  function renderLista() {
    const cont = ELEMENTOS.lista;
    const scroll = cont.scrollTop;
    cont.textContent = '';

    const lista = estacionesVisibles();
    ELEMENTOS.contador.textContent = lista.length
      ? `${lista.length} gasolinera${lista.length === 1 ? '' : 's'} a ${estado.radio} km de ${estado.centroNombre}`
      : 'Sin gasolineras en el radio';
    ELEMENTOS.notaOrden.textContent = estado.orden === 'distancia' ? 'por cercanía' : 'por precio';

    if (!lista.length) {
      const filtros = [estado.soloConProducto && 'con precio', estado.soloAbiertas && 'abiertas'].filter(Boolean);
      cont.appendChild(el('div', 'vacio-lista', filtros.length
        ? `No hay gasolineras ${filtros.join(' y ')} en ${estado.radio} km. Prueba a ampliar el radio o a quitar filtros.`
        : `No hay gasolineras en ${estado.radio} km. Prueba a ampliar el radio.`));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const est of lista) frag.appendChild(tarjeta(est));
    cont.appendChild(frag);
    cont.scrollTop = scroll;
  }

  function precioTarjeta(est, esMejor) {
    const cont = el('div', 'tarjeta-precios');
    const valor = valorDe(est);
    if (typeof valor !== 'number') {
      cont.append(el('div', 'precio-actual', '—'), el('div', 'precio-sub', 'sin precio'));
      return cont;
    }
    const grande = el('div', `precio-actual ${tramo(valor) ? 't-' + tramo(valor) : ''}`);
    grande.append(document.createTextNode(precio(valor)), el('small', null, ' €/L'));
    cont.appendChild(grande);

    if (esMejor) {
      cont.appendChild(el('div', 'precio-sub', 'la más barata'));
    } else if (estado.stats) {
      const dif = valor - estado.stats.mejor.precio;
      if (dif > 0.0005) {
        const sub = el('div', 'precio-sub sube', `+${precio(dif)} €`);
        sub.title = `${euros(dif * estado.deposito)} más en un depósito de ${estado.deposito} L`;
        cont.appendChild(sub);
      } else if (esPublica(est)) {
        cont.appendChild(el('div', 'precio-sub', 'mismo precio'));
      }
    }
    return cont;
  }

  function tarjeta(est) {
    const esMejor = Boolean(estado.stats && estado.stats.mejor.id === est.id);
    const h = horarioDe(est);
    const art = el('article', 'tarjeta');
    art.dataset.id = est.id;
    if (esMejor) art.classList.add('mejor');
    if (h.abierta === false) art.classList.add('cerrada');
    if (estado.seleccionada === est.id) art.classList.add('seleccionada');

    const avatar = el('div', 'tarjeta-avatar', iniciales(est.rotulo));
    avatar.setAttribute('aria-hidden', 'true');
    if (!esMejor) avatar.style.background = colorMarca(est.rotulo);

    const cuerpo = el('div', 'tarjeta-cuerpo');
    const titulo = el('h3', 'tarjeta-titulo');
    titulo.appendChild(el('span', null, est.rotulo));
    if (esMejor) titulo.appendChild(el('span', 'tag mejora', '★ Mejor precio'));
    cuerpo.appendChild(titulo);
    cuerpo.appendChild(el('div', 'tarjeta-direccion', [est.direccion, est.municipio || est.localidad].filter(Boolean).join(' · ')));

    const meta = el('div', 'tarjeta-meta');
    meta.appendChild(el('span', 'tag', distancia(est.distancia)));
    const th = textoHorario(h, est);
    if (th) {
      const tag = el('span', `tag ${th.clase}`, th.texto);
      if (est.horario) tag.title = est.horario;
      meta.appendChild(tag);
    }
    if (!esPublica(est)) {
      const tag = el('span', 'tag aviso', 'Venta restringida');
      tag.title = 'Sólo para socios o clientes autorizados';
      meta.appendChild(tag);
    }
    cuerpo.appendChild(meta);

    art.append(avatar, cuerpo, precioTarjeta(est, esMejor));

    const otros = el('div', 'tarjeta-otros');
    for (const p of estado.productos) {
      const v = est.precios[p.key];
      if (p.key === estado.producto || typeof v !== 'number') continue;
      const item = el('span', 'otros-item');
      item.append(el('b', null, p.abrev || p.nombre), document.createTextNode(` ${precio(v)}`));
      otros.appendChild(item);
    }
    if (otros.childElementCount) art.appendChild(otros);

    const enlaces = el('div', 'tarjeta-enlaces');
    const ver = boton('mini-enlace', 'Ver en el mapa', (ev) => { ev.stopPropagation(); enfocar(est); });
    ver.setAttribute('aria-label', `Ver ${est.rotulo} en el mapa`);
    const ruta = el('a', 'mini-enlace', 'Cómo llegar');
    ruta.href = enlaceGoogle(est, 'ruta');
    ruta.target = '_blank';
    ruta.rel = 'noopener';
    ruta.setAttribute('aria-label', `Cómo llegar a ${est.rotulo} (se abre en Google Maps)`);
    ruta.addEventListener('click', (ev) => ev.stopPropagation());
    enlaces.append(ver, ruta);
    art.appendChild(enlaces);

    // Toda la tarjeta es clicable con el ratón; con teclado se usa el botón "Ver en el mapa".
    art.addEventListener('click', () => enfocar(est));
    return art;
  }

  /** Marca en la lista la gasolinera cuyo popup está abierto. */
  function resaltarTarjeta(id, desplazar) {
    estado.seleccionada = id;
    let destino = null;
    for (const t of ELEMENTOS.lista.querySelectorAll('.tarjeta')) {
      const es = t.dataset.id === id;
      t.classList.toggle('seleccionada', es);
      if (es) destino = t;
    }
    if (desplazar && destino && !pantallaEstrecha()) {
      destino.scrollIntoView({ block: 'nearest', behavior: reducirMovimiento() ? 'auto' : 'smooth' });
    }
  }

  /* ------------------------------------------------------------------ *
   * Eventos
   * ------------------------------------------------------------------ */
  function soloDigitos(input) {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
    });
  }

  function alternarPantallaCompleta(activar) {
    const full = typeof activar === 'boolean' ? activar : !ELEMENTOS.mapaWrap.classList.contains('full');
    document.body.classList.toggle('mapa-full', full);
    ELEMENTOS.mapaWrap.classList.toggle('full', full);
    ELEMENTOS.btnMapa.setAttribute('aria-pressed', String(full));
    ELEMENTOS.btnMapa.setAttribute('aria-label', full ? 'Salir de pantalla completa' : 'Ampliar mapa');
    ELEMENTOS.btnMapa.title = full ? 'Salir de pantalla completa (Esc)' : 'Ver el mapa a pantalla completa';
    setTimeout(redimensionarMapa, 260);
  }

  /** Cambio de filtro que sólo afecta a la presentación. */
  function alCambiar(control, aplicar) {
    control.addEventListener('change', () => {
      aplicar();
      guardarPrefs();
      actualizarUrl();
      if (estado.estaciones.length) render();
    });
  }

  function conectarEventos() {
    ELEMENTOS.formBuscar.addEventListener('submit', (ev) => {
      ev.preventDefault();
      buscarPorCp(ELEMENTOS.inputCp.value);
    });
    ELEMENTOS.formCp2.addEventListener('submit', (ev) => {
      ev.preventDefault();
      buscarPorCp(ELEMENTOS.inputCp2.value);
    });
    soloDigitos(ELEMENTOS.inputCp);
    soloDigitos(ELEMENTOS.inputCp2);

    ELEMENTOS.btnUbicacion.addEventListener('click', pedirUbicacion);
    ELEMENTOS.btnUbicacion2.addEventListener('click', pedirUbicacion);

    alCambiar(ELEMENTOS.selectProducto, () => { estado.producto = ELEMENTOS.selectProducto.value; });
    alCambiar(ELEMENTOS.selectOrden, () => { estado.orden = ELEMENTOS.selectOrden.value; });
    alCambiar(ELEMENTOS.chkSolo, () => { estado.soloConProducto = ELEMENTOS.chkSolo.checked; });
    alCambiar(ELEMENTOS.chkAbiertas, () => { estado.soloAbiertas = ELEMENTOS.chkAbiertas.checked; });
    alCambiar(ELEMENTOS.inputDeposito, () => {
      estado.deposito = leerDeposito(ELEMENTOS.inputDeposito.value);
      ELEMENTOS.inputDeposito.value = String(estado.deposito);
    });

    // El radio sí exige una nueva consulta, repitiendo la misma búsqueda (CP o ubicación).
    ELEMENTOS.selectRadio.addEventListener('change', () => {
      estado.radio = Number(ELEMENTOS.selectRadio.value);
      guardarPrefs();
      actualizarUrl();
      if (estado.busqueda) buscar(estado.busqueda);
    });

    ELEMENTOS.btnMapa.addEventListener('click', () => alternarPantallaCompleta());
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && ELEMENTOS.mapaWrap.classList.contains('full')) alternarPantallaCompleta(false);
    });

    window.addEventListener('resize', redimensionarMapa);
  }

  /* ------------------------------------------------------------------ *
   * Arranque
   * ------------------------------------------------------------------ */
  async function init() {
    crearMapa();
    conectarEventos();
    await cargarProductos();
    const cpInicial = aplicarPrefsIniciales();
    renderProducto();
    actualizarEstado();
    if (cpInicial) buscarPorCp(cpInicial);

    // Cada 5 minutos se revisa el estado de los datos y si las gasolineras
    // siguen abiertas.
    setInterval(() => {
      actualizarEstado();
      if (estado.estaciones.length) render();
    }, 5 * 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
