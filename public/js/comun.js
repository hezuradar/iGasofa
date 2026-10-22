/* ==========================================================================
   iGasofa — estado compartido, referencias al DOM y utilidades
   ========================================================================== */

export const PRODUCTO_DEFECTO = 'GOA';
export const RADIO_DEFECTO = 10;
export const DESVIO_DEFECTO = 2;
export const DEPOSITO_DEFECTO = 50;
export const RADIOS = [2, 5, 10, 15, 25, 50];
export const DESVIOS = [1, 2, 5, 10];
export const POR_PAGINA = 30;

export const estado = {
  productos: [],
  porClave: new Map(),
  estaciones: [],
  modo: 'cerca', // 'cerca' | 'ruta'
  busqueda: null, // { tipo: 'cp', cp } | { tipo: 'coords', lat, lon } | { tipo: 'ruta', origen, destino }
  ruta: null, // { origen, destino, distanciaKm, duracionMin, coords }
  centro: null,
  centroNombre: '',
  producto: PRODUCTO_DEFECTO,
  radio: RADIO_DEFECTO,
  radioMostrado: RADIO_DEFECTO, // radio de los resultados en pantalla
  desvio: DESVIO_DEFECTO,
  orden: 'distancia',
  soloConProducto: false,
  soloAbiertas: false,
  filtroTexto: '',
  limite: POR_PAGINA,
  deposito: DEPOSITO_DEFECTO,
  stats: null,
  horarios: new Map(),
  seleccionada: null,
  popupId: null,
  repintando: false,
  peticion: 0,
  pendiente: null, // búsqueda lanzada que aún no ha respondido
  vista: 'lista', // vista activa en móvil
  carto: { clave: null },
};

const $ = (sel) => document.querySelector(sel);

export const ELEMENTOS = {
  formBuscar: $('#form-buscar'),
  formRuta: $('#form-ruta'),
  inputCp: $('#input-cp'),
  inputOrigen: $('#input-origen'),
  inputDestino: $('#input-destino'),
  btnOrigenUbicacion: $('#btn-origen-ubicacion'),
  btnInvertir: $('#btn-invertir'),
  modos: Array.from(document.querySelectorAll('input[name="modo"]')),
  btnUbicacion: $('#btn-ubicacion'),
  btnUbicacion2: $('#btn-ubicacion-2'),
  btnRuta2: $('#btn-ruta-2'),
  formCp2: $('#form-cp-2'),
  inputCp2: $('#input-cp-2'),
  vacio: $('#vacio'),
  panel: $('.panel'),
  panelBody: $('#panel-body'),
  rutaInfo: $('#ruta-info'),
  resumen: $('#resumen'),
  selectProducto: $('#select-producto'),
  selectRadio: $('#select-radio'),
  campoRadio: $('#campo-radio'),
  selectDesvio: $('#select-desvio'),
  campoDesvio: $('#campo-desvio'),
  selectOrden: $('#select-orden'),
  chkSolo: $('#chk-solo'),
  chkAbiertas: $('#chk-abiertas'),
  inputDeposito: $('#input-deposito'),
  inputFiltro: $('#input-filtro'),
  contador: $('#contador'),
  notaOrden: $('#nota-orden'),
  lista: $('#lista'),
  btnMas: $('#btn-mas'),
  mapa: $('#mapa'),
  mapaFondo: $('#mapa-fondo'),
  mapaCargando: $('#mapa-cargando'),
  mapaWrap: $('.mapa-wrap'),
  aviso: $('#aviso'),
  estado: $('#estado'),
  estadoTexto: $('#estado-texto'),
  btnMapa: $('#btn-mapa'),
  tabs: Array.from(document.querySelectorAll('.tabs-movil [data-vista]')),
  btnEditarBusqueda: $('#btn-editar-busqueda'),
};

/* ------------------------------------------------------------------ *
 * Formato
 * ------------------------------------------------------------------ */
const fmtPrecio = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const fmtEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export const precio = (v) => fmtPrecio.format(v);
export const euros = (v) => fmtEuros.format(v);
export const limpiarCp = (cp) => String(cp || '').trim().replace(/\s+/g, '');

export function distancia(km) {
  if (km === null || km === undefined) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function duracion(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "20560, Oñati, Debagoiena, Gipuzkoa, País Vasco, España" → "Oñati, Debagoiena". */
export function nombreCorto(nombre) {
  const partes = String(nombre || '').split(',').map((s) => s.trim()).filter((s) => s && !/^\d{5}$/.test(s));
  return partes.slice(0, 2).join(', ');
}

export function nombreProducto(clave = estado.producto) {
  const p = estado.porClave.get(clave);
  return p ? p.nombre : clave;
}

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */
export function el(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null) n.textContent = texto;
  return n;
}

export function boton(clase, texto, alPulsar) {
  const b = el('button', clase, texto);
  b.type = 'button';
  b.addEventListener('click', alPulsar);
  return b;
}

/** Precio legible para lectores de pantalla: "1,669 euros por litro". */
export function nodoPrecio(clase, valor) {
  const n = el('div', clase);
  const visible = el('span');
  visible.setAttribute('aria-hidden', 'true');
  visible.append(document.createTextNode(precio(valor)), el('small', null, ' €/L'));
  n.append(visible, el('span', 'sr-only', `${precio(valor)} euros por litro`));
  return n;
}

let temporizadorAviso = null;

export function aviso(mensaje, tipo = '') {
  ELEMENTOS.aviso.textContent = mensaje;
  ELEMENTOS.aviso.className = `aviso ${tipo}`.trim();
  ELEMENTOS.aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { ELEMENTOS.aviso.hidden = true; }, 5200);
}

export function pintarEstado(clase, texto, titulo) {
  ELEMENTOS.estado.className = `estado ${clase}`;
  ELEMENTOS.estadoTexto.textContent = texto;
  if (titulo) ELEMENTOS.estado.title = titulo;
}

/* ------------------------------------------------------------------ *
 * Varios
 * ------------------------------------------------------------------ */
export function colorMarca(nombre) {
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

export function iniciales(nombre) {
  const limpio = (nombre || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export function enlaceGoogle(destino, modo) {
  const { lat, lon } = destino;
  if (modo === 'ruta') return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export const reducirMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const pantallaEstrecha = () => window.matchMedia('(max-width: 900px)').matches;

export async function pedir(url) {
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
