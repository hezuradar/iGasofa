/* ==========================================================================
   iGasofa — arranque, búsquedas (cerca de un punto o a lo largo de una
   ruta), preferencias, URL compartible y eventos.
   Depende de Leaflet, horario.js y mapa-vector.js (cargados antes).
   ========================================================================== */
import {
  estado, ELEMENTOS, PRODUCTO_DEFECTO, RADIO_DEFECTO, DESVIO_DEFECTO, DEPOSITO_DEFECTO,
  RADIOS, DESVIOS, POR_PAGINA, aviso, pintarEstado, limpiarCp, nombreCorto, pedir, pantallaEstrecha,
} from './comun.js';
import {
  crearMapa, marcarUsuario, quitarUsuario, pintarRuta, encuadrar, encuadrarRuta, pintarMarcadores,
  cambiarVista, alternarPantallaCompleta, cerrarPopup, recargarEstiloVector, redimensionarMapa,
} from './mapa.js';
import { render, renderProducto, renderLista, mostrarCargando, mostrarVacio, mostrarMas } from './panel.js';

const CLAVE_PREFS = 'igasofa:prefs';
const TEXTO_MI_UBICACION = 'Mi ubicación';
const ORDENES_POR_MODO = {
  cerca: [['distancia', 'Distancia'], ['precio', 'Más barato'], ['precio-desc', 'Más caro']],
  ruta: [['ruta', 'Orden del trayecto'], ['precio', 'Más barato'], ['distancia', 'Menor desvío'], ['precio-desc', 'Más caro']],
};
const ordenPorModo = { cerca: 'distancia', ruta: 'ruta' };

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
  const previas = leerPrefs();
  const b = estado.busqueda;
  const prefs = {
    modo: estado.modo,
    producto: estado.producto,
    radio: estado.radio,
    desvio: estado.desvio,
    orden: ordenPorModo.cerca,
    ordenRuta: ordenPorModo.ruta,
    soloConProducto: estado.soloConProducto,
    soloAbiertas: estado.soloAbiertas,
    deposito: estado.deposito,
    ultimoCp: b && b.tipo === 'cp' ? b.cp : previas.ultimoCp,
    // Nunca se guardan coordenadas: sólo lo que el usuario escribió.
    ultimaRuta: b && b.tipo === 'ruta'
      ? { origen: b.origenEsUbicacion ? '' : b.origen, destino: b.destino }
      : previas.ultimaRuta,
  };
  try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs)); } catch { /* modo privado */ }
}

/** La ubicación exacta del usuario nunca va a la URL. */
function actualizarUrl() {
  const p = new URLSearchParams();
  const b = estado.busqueda;
  const actual = new URLSearchParams(location.search);
  if (b && b.tipo === 'cp') {
    p.set('cp', b.cp);
  } else if (b && b.tipo === 'ruta') {
    if (!b.origenEsUbicacion) p.set('origen', b.origen);
    p.set('destino', b.destino);
    if (estado.desvio !== DESVIO_DEFECTO) p.set('desvio', String(estado.desvio));
  } else if (!b) {
    // Mientras no haya una búsqueda resuelta se conserva lo que traía la URL.
    for (const k of ['cp', 'origen', 'destino', 'desvio']) if (actual.get(k)) p.set(k, actual.get(k));
  }
  if (estado.producto !== PRODUCTO_DEFECTO) p.set('producto', estado.producto);
  if (estado.modo === 'cerca' && estado.radio !== RADIO_DEFECTO) p.set('radio', String(estado.radio));
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function leerDeposito(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 && n <= 200 ? n : DEPOSITO_DEFECTO;
}

const primeroValido = (valores, permitidos) => valores.map(Number).find((v) => permitidos.includes(v));

/** Aplica preferencias y URL. Devuelve la búsqueda que hay que lanzar al cargar, si la hay. */
function aplicarPrefsIniciales() {
  const prefs = leerPrefs();
  const url = new URLSearchParams(location.search);

  const producto = url.get('producto') || prefs.producto;
  if (producto && estado.porClave.has(producto)) estado.producto = producto;
  estado.radio = primeroValido([url.get('radio'), prefs.radio], RADIOS) || RADIO_DEFECTO;
  estado.desvio = primeroValido([url.get('desvio'), prefs.desvio], DESVIOS) || DESVIO_DEFECTO;
  if (ORDENES_POR_MODO.cerca.some(([v]) => v === prefs.orden)) ordenPorModo.cerca = prefs.orden;
  if (ORDENES_POR_MODO.ruta.some(([v]) => v === prefs.ordenRuta)) ordenPorModo.ruta = prefs.ordenRuta;
  estado.soloConProducto = Boolean(prefs.soloConProducto);
  estado.soloAbiertas = Boolean(prefs.soloAbiertas);
  estado.deposito = leerDeposito(prefs.deposito);

  ELEMENTOS.selectRadio.value = String(estado.radio);
  ELEMENTOS.selectDesvio.value = String(estado.desvio);
  ELEMENTOS.chkSolo.checked = estado.soloConProducto;
  ELEMENTOS.chkAbiertas.checked = estado.soloAbiertas;
  ELEMENTOS.inputDeposito.value = String(estado.deposito);

  const ultimoCp = limpiarCp(prefs.ultimoCp || '');
  if (/^\d{5}$/.test(ultimoCp)) ELEMENTOS.inputCp.value = ELEMENTOS.inputCp2.value = ultimoCp;
  const ultima = prefs.ultimaRuta || {};
  ELEMENTOS.inputOrigen.value = ultima.origen || '';
  ELEMENTOS.inputDestino.value = ultima.destino || '';

  const origen = (url.get('origen') || '').trim();
  const destino = (url.get('destino') || '').trim();
  const cp = limpiarCp(url.get('cp') || '');
  if (destino) {
    ELEMENTOS.inputOrigen.value = origen;
    ELEMENTOS.inputDestino.value = destino;
    cambiarModo('ruta');
    return origen ? { tipo: 'ruta', origen, destino } : null;
  }
  cambiarModo(/^\d{5}$/.test(cp) ? 'cerca' : prefs.modo === 'ruta' ? 'ruta' : 'cerca');
  return /^\d{5}$/.test(cp) ? { tipo: 'cp', cp } : null;
}

/* ------------------------------------------------------------------ *
 * Modo de búsqueda
 * ------------------------------------------------------------------ */
function rellenarOrden() {
  const sel = ELEMENTOS.selectOrden;
  sel.textContent = '';
  for (const [valor, texto] of ORDENES_POR_MODO[estado.modo]) {
    const op = document.createElement('option');
    op.value = valor;
    op.textContent = texto;
    sel.appendChild(op);
  }
  estado.orden = ordenPorModo[estado.modo];
  sel.value = estado.orden;
}

const modoDe = (busqueda) => (busqueda && busqueda.tipo === 'ruta' ? 'ruta' : 'cerca');

/** Quita los resultados en pantalla (y anula la búsqueda en curso). */
function limpiarResultados() {
  estado.peticion++;
  estado.pendiente = null;
  estado.estaciones = [];
  estado.busqueda = null;
  estado.ruta = null;
  estado.stats = null;
  estado.popupId = null;
  pintarRuta(null);
  pintarMarcadores();
  plegarBusqueda(false);
  mostrarVacio();
  history.replaceState(null, '', location.pathname);
  actualizarUrl();
}

function cambiarModo(modo, { foco = false } = {}) {
  estado.modo = modo;
  document.body.dataset.modo = modo;
  for (const r of ELEMENTOS.modos) r.checked = r.value === modo;
  ELEMENTOS.formBuscar.hidden = modo !== 'cerca';
  ELEMENTOS.formRuta.hidden = modo !== 'ruta';
  ELEMENTOS.campoRadio.hidden = modo !== 'cerca';
  ELEMENTOS.campoDesvio.hidden = modo !== 'ruta';
  rellenarOrden();
  if (foco) (modo === 'ruta' ? (ELEMENTOS.inputOrigen.value ? ELEMENTOS.inputDestino : ELEMENTOS.inputOrigen) : ELEMENTOS.inputCp).focus();
  // Los resultados de una búsqueda "cerca" no tienen sentido en modo ruta, ni al revés.
  const actual = estado.pendiente || estado.busqueda;
  if (actual && modoDe(actual) !== modo) limpiarResultados();
  else if (estado.estaciones.length) render();
}

/* ------------------------------------------------------------------ *
 * Búsquedas
 * ------------------------------------------------------------------ */
function urlBusqueda(b) {
  if (b.tipo === 'cp') return `/api/postal/${b.cp}?radio=${estado.radio}`;
  if (b.tipo === 'coords') return `/api/estaciones?lat=${b.lat}&lon=${b.lon}&radio=${estado.radio}`;
  const origen = b.origenEsUbicacion ? b.origenCoords : b.origen;
  return `/api/ruta?origen=${encodeURIComponent(origen)}&destino=${encodeURIComponent(b.destino)}&desvio=${estado.desvio}`;
}

/** Lanza una búsqueda; si llega otra antes de responder, ésta se descarta. */
async function buscar(busqueda) {
  const turno = ++estado.peticion;
  estado.pendiente = busqueda;
  cerrarPopup();
  mostrarCargando();
  try {
    const d = await pedir(urlBusqueda(busqueda));
    if (turno !== estado.peticion) return;
    estado.pendiente = null;
    aplicarResultado(d, busqueda);
  } catch (e) {
    if (turno !== estado.peticion) return;
    estado.pendiente = null;
    aviso(e.message, 'error');
    if (estado.estaciones.length) {
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

function buscarRuta() {
  const origen = ELEMENTOS.inputOrigen.value.trim();
  const destino = ELEMENTOS.inputDestino.value.trim();
  if (!origen || !destino) {
    aviso('Indica el origen y el destino de la ruta.', 'error');
    (origen ? ELEMENTOS.inputDestino : ELEMENTOS.inputOrigen).focus();
    return;
  }
  const coords = ELEMENTOS.inputOrigen.dataset.coords;
  const origenEsUbicacion = origen === TEXTO_MI_UBICACION && Boolean(coords);
  buscar({ tipo: 'ruta', origen, destino, origenEsUbicacion, origenCoords: coords });
}

function aplicarResultado(datos, busqueda) {
  if (modoDe(busqueda) !== estado.modo) cambiarModo(modoDe(busqueda));
  // El punto "Tu ubicación" sólo se mantiene si la búsqueda parte de ella.
  if (busqueda.tipo !== 'coords' && !busqueda.origenEsUbicacion) quitarUsuario();
  if (datos.truncado) aviso('La ruta es muy larga: se muestran sólo parte de las gasolineras. Reduce el desvío máximo.', 'error');
  estado.estaciones = datos.estaciones || [];
  estado.busqueda = busqueda;
  estado.radioMostrado = estado.radio;
  estado.limite = POR_PAGINA;
  estado.seleccionada = null;
  estado.popupId = null;

  if (busqueda.tipo === 'ruta') {
    estado.ruta = { ...datos.ruta, origen: datos.origen, destino: datos.destino };
    estado.centro = null;
    estado.centroNombre = '';
    pintarRuta(estado.ruta);
    encuadrarRuta(estado.ruta);
  } else {
    estado.ruta = null;
    pintarRuta(null);
    estado.centro = datos.centro;
    estado.centroNombre = busqueda.tipo === 'cp' ? nombreCorto(datos.nombre) || `CP ${busqueda.cp}` : 'tu ubicación';
    if (estado.centro) encuadrar(estado.centro, estado.radio);
  }

  if (datos.fecha) pintarEstado(datos.desactualizado ? 'aviso' : 'listo', `Datos: ${datos.fecha}`);
  if (datos.desactualizado) aviso('El Ministerio no responde: se muestran los últimos precios disponibles.', 'error');

  guardarPrefs();
  actualizarUrl();
  render();
  cambiarVista('lista');
  plegarBusqueda(busqueda.tipo === 'ruta' && pantallaEstrecha());
}

/* En el móvil el formulario de ruta ocupa media pantalla: tras buscar se
   pliega en una línea "Origen → Destino · Cambiar". */
function plegarBusqueda(plegar) {
  // Si el foco estaba en el formulario que se oculta, pasa al botón que lo resume.
  const focoEnBuscador = ELEMENTOS.formRuta.contains(document.activeElement);
  document.body.classList.toggle('busqueda-plegada', plegar);
  ELEMENTOS.btnEditarBusqueda.hidden = !plegar;
  if (!plegar || !estado.ruta) return;
  if (focoEnBuscador) ELEMENTOS.btnEditarBusqueda.focus();
  const nombre = (lugar) => nombreCorto(lugar.nombre).split(',')[0] || lugar.nombre;
  ELEMENTOS.btnEditarBusqueda.querySelector('.busqueda-resumen-texto').textContent =
    `${nombre(estado.ruta.origen)} → ${nombre(estado.ruta.destino)}`;
  ELEMENTOS.btnEditarBusqueda.setAttribute('aria-label',
    `Ruta de ${nombre(estado.ruta.origen)} a ${nombre(estado.ruta.destino)}. Cambiar la búsqueda`);
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

/**
 * Si el servidor tiene una clave de Carto (CARTO_KEY o config.json) se
 * aplica al estilo vectorial: teselas, glifos y sprite. Es opcional; sin
 * clave, Carto sirve la modalidad pública y todo funciona igual.
 */
function aplicarClaveCarto(clave) {
  if (!clave || estado.carto.clave === clave) return;
  estado.carto.clave = clave;
  recargarEstiloVector();
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

/* ------------------------------------------------------------------ *
 * Geolocalización
 * ------------------------------------------------------------------ */
function estadoBotonUbicacion(botones, buscando) {
  for (const b of botones) {
    b.classList.toggle('activo', buscando);
    b.setAttribute('aria-busy', String(buscando));
    const texto = b.querySelector('span');
    if (texto) texto.textContent = buscando ? 'Buscando…' : b.dataset.texto;
  }
}

function obtenerUbicacion(botones, alObtener) {
  if (!('geolocation' in navigator)) {
    aviso('Este navegador no soporta geolocalización. Escribe una dirección o un código postal.', 'error');
    return;
  }
  if (!window.isSecureContext) {
    aviso('La geolocalización necesita HTTPS o localhost. Escribe una dirección o un código postal.', 'error');
    return;
  }
  estadoBotonUbicacion(botones, true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      estadoBotonUbicacion(botones, false);
      const { latitude, longitude } = pos.coords;
      marcarUsuario(latitude, longitude);
      alObtener(latitude, longitude);
    },
    (err) => {
      estadoBotonUbicacion(botones, false);
      aviso(err.code === 1
        ? 'Permiso de ubicación denegado. Escribe una dirección o un código postal.'
        : 'No se pudo obtener tu ubicación. Escribe una dirección o un código postal.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function buscarCercaDeMi() {
  obtenerUbicacion([ELEMENTOS.btnUbicacion, ELEMENTOS.btnUbicacion2], (lat, lon) => {
    if (estado.modo !== 'cerca') cambiarModo('cerca');
    buscar({ tipo: 'coords', lat, lon });
  });
}

function origenEnMiUbicacion() {
  obtenerUbicacion([ELEMENTOS.btnOrigenUbicacion], (lat, lon) => {
    ELEMENTOS.inputOrigen.value = TEXTO_MI_UBICACION;
    ELEMENTOS.inputOrigen.dataset.coords = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (ELEMENTOS.inputDestino.value.trim()) buscarRuta();
    else ELEMENTOS.inputDestino.focus();
  });
}

function invertirRuta() {
  const { inputOrigen: o, inputDestino: d } = ELEMENTOS;
  const coords = o.dataset.coords;
  [o.value, d.value] = [d.value, o.value];
  // "Mi ubicación" sólo tiene sentido como origen.
  if (d.value === TEXTO_MI_UBICACION) {
    d.value = '';
    delete o.dataset.coords;
  } else if (coords && o.value === TEXTO_MI_UBICACION) {
    o.dataset.coords = coords;
  } else {
    delete o.dataset.coords;
  }
  if (o.value && d.value) buscarRuta();
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */
function soloDigitos(input) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 5);
  });
}

/** Cambio de filtro que sólo afecta a la presentación. */
function alCambiar(control, aplicar) {
  control.addEventListener('change', () => {
    aplicar();
    estado.limite = POR_PAGINA;
    guardarPrefs();
    actualizarUrl();
    if (estado.estaciones.length) render();
  });
}

function conectarEventos() {
  ELEMENTOS.formBuscar.addEventListener('submit', (ev) => { ev.preventDefault(); buscarPorCp(ELEMENTOS.inputCp.value); });
  ELEMENTOS.formCp2.addEventListener('submit', (ev) => { ev.preventDefault(); buscarPorCp(ELEMENTOS.inputCp2.value); });
  ELEMENTOS.formRuta.addEventListener('submit', (ev) => { ev.preventDefault(); buscarRuta(); });
  soloDigitos(ELEMENTOS.inputCp);
  soloDigitos(ELEMENTOS.inputCp2);

  for (const b of [ELEMENTOS.btnUbicacion, ELEMENTOS.btnUbicacion2, ELEMENTOS.btnOrigenUbicacion]) {
    const texto = b.querySelector('span');
    if (texto) b.dataset.texto = texto.textContent;
  }
  ELEMENTOS.btnUbicacion.addEventListener('click', buscarCercaDeMi);
  ELEMENTOS.btnUbicacion2.addEventListener('click', buscarCercaDeMi);
  ELEMENTOS.btnOrigenUbicacion.addEventListener('click', origenEnMiUbicacion);
  ELEMENTOS.btnInvertir.addEventListener('click', invertirRuta);
  ELEMENTOS.btnRuta2.addEventListener('click', () => cambiarModo('ruta', { foco: true }));
  // Si el usuario edita el origen deja de ser "mi ubicación".
  ELEMENTOS.inputOrigen.addEventListener('input', () => { delete ELEMENTOS.inputOrigen.dataset.coords; });

  // Con ratón o dedo el foco salta al primer campo; con las flechas del
  // teclado se queda en el grupo para poder seguir moviéndose por él.
  let porPuntero = false;
  ELEMENTOS.modos[0].closest('fieldset').addEventListener('pointerdown', () => { porPuntero = true; });
  for (const r of ELEMENTOS.modos) {
    r.addEventListener('change', () => {
      if (!r.checked) return;
      cambiarModo(r.value, { foco: porPuntero });
      porPuntero = false;
      guardarPrefs();
    });
  }

  alCambiar(ELEMENTOS.selectProducto, () => { estado.producto = ELEMENTOS.selectProducto.value; });
  alCambiar(ELEMENTOS.selectOrden, () => {
    estado.orden = ELEMENTOS.selectOrden.value;
    ordenPorModo[estado.modo] = estado.orden;
  });
  alCambiar(ELEMENTOS.chkSolo, () => { estado.soloConProducto = ELEMENTOS.chkSolo.checked; });
  alCambiar(ELEMENTOS.chkAbiertas, () => { estado.soloAbiertas = ELEMENTOS.chkAbiertas.checked; });
  alCambiar(ELEMENTOS.inputDeposito, () => {
    estado.deposito = leerDeposito(ELEMENTOS.inputDeposito.value);
    ELEMENTOS.inputDeposito.value = String(estado.deposito);
  });

  // El radio y el desvío sí exigen una nueva consulta, repitiendo la misma búsqueda.
  ELEMENTOS.selectRadio.addEventListener('change', () => {
    estado.radio = Number(ELEMENTOS.selectRadio.value);
    guardarPrefs();
    actualizarUrl();
    if (estado.busqueda && estado.busqueda.tipo !== 'ruta') buscar(estado.busqueda);
  });
  ELEMENTOS.selectDesvio.addEventListener('change', () => {
    estado.desvio = Number(ELEMENTOS.selectDesvio.value);
    guardarPrefs();
    actualizarUrl();
    if (estado.busqueda && estado.busqueda.tipo === 'ruta') buscar(estado.busqueda);
  });

  let temporizadorFiltro = null;
  ELEMENTOS.inputFiltro.addEventListener('input', () => {
    clearTimeout(temporizadorFiltro);
    temporizadorFiltro = setTimeout(() => {
      estado.filtroTexto = ELEMENTOS.inputFiltro.value;
      estado.limite = POR_PAGINA;
      renderLista();
      pintarMarcadores();
    }, 150);
  });
  ELEMENTOS.btnMas.addEventListener('click', mostrarMas);

  for (const t of ELEMENTOS.tabs) t.addEventListener('click', () => cambiarVista(t.dataset.vista));
  ELEMENTOS.btnEditarBusqueda.addEventListener('click', () => {
    plegarBusqueda(false);
    ELEMENTOS.inputDestino.focus();
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
  cambiarVista('lista');
  await cargarProductos();
  const inicial = aplicarPrefsIniciales();
  renderProducto();
  actualizarEstado();
  if (inicial) buscar(inicial);

  // Cada 5 minutos se revisa el estado de los datos y si las gasolineras
  // siguen abiertas.
  setInterval(() => {
    actualizarEstado();
    if (estado.estaciones.length) render();
  }, 5 * 60 * 1000);
}

init();
